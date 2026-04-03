/**
 * Background job scheduler with observable state.
 * Tracks last run time, status, duration, result, and errors for each job.
 * Exposes manual trigger + status query for the admin panel.
 */

import pino from "pino";
import { processTimedOutJobs } from "../modules/jobs/queue.orchestrator.js";
import { expireStaleClaims } from "../modules/matching/claim.service.js";
import { processReminders } from "../modules/inbox/reminder.scheduler.js";
import { runPrestigeGraphJob } from "../modules/admin/prestige-graph.job.js";
import { syncAllApprovedRepos } from "../modules/sync/issue-sync.service.js";
import { discoverRepositories } from "../modules/sync/repo-finder.service.js";

const logger = pino({ name: "scheduler" });

const FIVE_MINUTES = 5 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const THIRTY_MINUTES = 30 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const SIX_HOURS = 6 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

export interface JobStatus {
  name: string;
  description: string;
  intervalMs: number;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastStatus: "success" | "error" | "never_run";
  lastError: string | null;
  lastResult: Record<string, unknown> | null;
  running: boolean;
  runCount: number;
}

type SummarizeFn = (raw: unknown) => Record<string, unknown>;

interface JobEntry {
  name: string;
  description: string;
  fn: () => Promise<unknown>;
  summarize: SummarizeFn;
  intervalMs: number;
  runOnStart: boolean;
  lastRunAt: Date | null;
  lastDurationMs: number | null;
  lastStatus: "success" | "error" | "never_run";
  lastError: string | null;
  lastResult: Record<string, unknown> | null;
  running: boolean;
  runCount: number;
}

function summarizeSync(raw: unknown): Record<string, unknown> {
  if (!Array.isArray(raw)) return { info: "No data returned" };
  const results = raw as Array<{
    repoFullName?: string;
    issuesFetched?: number;
    issuesUpserted?: number;
    issuesClosed?: number;
    skipped?: boolean;
    error?: string;
  }>;
  const totalRepos = results.length;
  const fetched = results.reduce((s, r) => s + (r.issuesFetched ?? 0), 0);
  const upserted = results.reduce((s, r) => s + (r.issuesUpserted ?? 0), 0);
  const closed = results.reduce((s, r) => s + (r.issuesClosed ?? 0), 0);
  const skipped = results.filter((r) => r.skipped).length;
  const errors = results.filter((r) => r.error);
  const errorMessages = errors.slice(0, 5).map((r) => `${r.repoFullName}: ${r.error}`);
  return {
    totalRepos,
    issuesFetched: fetched,
    issuesUpserted: upserted,
    issuesClosed: closed,
    skippedNotModified: skipped,
    errorCount: errors.length,
    ...(errorMessages.length > 0 && { sampleErrors: errorMessages }),
  };
}

function summarizeDiscovery(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return { info: "No data returned" };
  const r = raw as { ok?: boolean; data?: { totalDiscovered?: number; newReposInserted?: number; skippedExisting?: number } };
  const data = r.data ?? (raw as Record<string, unknown>);
  return {
    totalDiscovered: (data as Record<string, unknown>).totalDiscovered ?? 0,
    newReposInserted: (data as Record<string, unknown>).newReposInserted ?? 0,
    skippedExisting: (data as Record<string, unknown>).skippedExisting ?? 0,
  };
}

function summarizeGeneric(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return { result: "completed" };
  if (typeof raw === "object") {
    try {
      const str = JSON.stringify(raw);
      if (str.length > 500) return { result: "completed", dataSize: str.length };
      return raw as Record<string, unknown>;
    } catch {
      return { result: "completed" };
    }
  }
  return { result: String(raw) };
}

const DEFAULT_STATE = {
  lastRunAt: null as Date | null,
  lastDurationMs: null as number | null,
  lastStatus: "never_run" as const,
  lastError: null as string | null,
  lastResult: null as Record<string, unknown> | null,
  running: false,
  runCount: 0,
};

const jobs: JobEntry[] = [
  {
    name: "processTimedOutJobs",
    description: "Process timed-out agent jobs",
    fn: processTimedOutJobs,
    summarize: summarizeGeneric,
    intervalMs: FIVE_MINUTES,
    runOnStart: false,
    ...DEFAULT_STATE,
  },
  {
    name: "processReminders",
    description: "Process inbox reminders",
    fn: processReminders,
    summarize: summarizeGeneric,
    intervalMs: FIFTEEN_MINUTES,
    runOnStart: false,
    ...DEFAULT_STATE,
  },
  {
    name: "syncAllApprovedRepos",
    description: "Sync issues for all approved repositories",
    fn: syncAllApprovedRepos,
    summarize: summarizeSync,
    intervalMs: THIRTY_MINUTES,
    runOnStart: true,
    ...DEFAULT_STATE,
  },
  {
    name: "expireStaleClaims",
    description: "Expire stale issue claims",
    fn: expireStaleClaims,
    summarize: summarizeGeneric,
    intervalMs: ONE_HOUR,
    runOnStart: false,
    ...DEFAULT_STATE,
  },
  {
    name: "discoverRepositories",
    description: "Discover new repositories from GitHub",
    fn: discoverRepositories,
    summarize: summarizeDiscovery,
    intervalMs: SIX_HOURS,
    runOnStart: true,
    ...DEFAULT_STATE,
  },
  {
    name: "runPrestigeGraphJob",
    description: "Recompute prestige graph scores",
    fn: runPrestigeGraphJob,
    summarize: summarizeGeneric,
    intervalMs: TWENTY_FOUR_HOURS,
    runOnStart: false,
    ...DEFAULT_STATE,
  },
];

async function executeJob(job: JobEntry): Promise<void> {
  if (job.running) return;
  job.running = true;
  const start = Date.now();
  try {
    const result = await job.fn();
    job.lastStatus = "success";
    job.lastError = null;
    job.lastResult = job.summarize(result);
  } catch (e: unknown) {
    job.lastStatus = "error";
    job.lastError = e instanceof Error ? e.message : String(e);
    job.lastResult = null;
    logger.error(
      { jobName: job.name, err: job.lastError },
      "Scheduled job failed"
    );
  } finally {
    job.lastRunAt = new Date();
    job.lastDurationMs = Date.now() - start;
    job.running = false;
    job.runCount++;
  }
}

const handles: NodeJS.Timeout[] = [];

export function startScheduler(): void {
  for (const job of jobs) {
    if (job.runOnStart) {
      setTimeout(() => executeJob(job), 10_000);
    }

    handles.push(
      setInterval(() => executeJob(job), job.intervalMs),
    );
  }
  logger.info({ jobCount: jobs.length }, "Started scheduled jobs");
}

export function stopScheduler(): void {
  for (const h of handles) {
    clearInterval(h);
  }
  handles.length = 0;
}

export function getJobStatuses(): JobStatus[] {
  return jobs.map((j) => ({
    name: j.name,
    description: j.description,
    intervalMs: j.intervalMs,
    lastRunAt: j.lastRunAt?.toISOString() ?? null,
    lastDurationMs: j.lastDurationMs,
    lastStatus: j.lastStatus,
    lastError: j.lastError,
    lastResult: j.lastResult,
    running: j.running,
    runCount: j.runCount,
  }));
}

export async function triggerJob(jobName: string): Promise<{ ok: boolean; error?: string }> {
  const job = jobs.find((j) => j.name === jobName);
  if (!job) return { ok: false, error: `Unknown job: ${jobName}` };
  if (job.running) return { ok: false, error: `Job ${jobName} is already running` };
  executeJob(job);
  return { ok: true };
}

export function getJobNames(): string[] {
  return jobs.map((j) => j.name);
}

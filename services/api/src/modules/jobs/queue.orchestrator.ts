/**
 * Queue orchestrator — manages job dispatch to the agent worker,
 * handles callbacks, timeout/DLQ logic, and status transitions.
 */

import { prisma } from "../../lib/prisma.js";
import { getAgentQueue } from "../../lib/queue.js";
import { evaluateGate, type GateInput } from "./gates.service.js";

const JOB_TIMEOUT_MS = 10 * 60 * 1000;
export const MAX_RETRY_COUNT = 2;

export interface WorkerCallbackPayload {
  jobId: string;
  ok: boolean;
  artifacts?: {
    diff: string;
    execution_trace: string;
    confidence_score: number;
    test_results: string;
    changed_files: string[];
    summary: string;
    risk_flags: string[];
  };
  error?: string;
}

/** Dispatch a job to the worker via HTTP or queue. */
export async function dispatchJob(
  jobId: string,
  issueId: string,
  llmProvider: string,
  llmModel: string,
  llmProviderOverride?: string | null
): Promise<void> {
  const queue = getAgentQueue();
  await queue.add("run", {
    jobId,
    issueId,
    llmProvider,
    llmModel,
    ...(llmProviderOverride ? { llmProviderOverride } : {}),
  });
}

/** Process a callback from the worker with job results. */
export async function handleWorkerCallback(
  payload: WorkerCallbackPayload
): Promise<void> {
  const job = await prisma.job.findUnique({
    where: { id: payload.jobId },
    include: { user: true, issue: { include: { repository: true } } },
  });

  if (!job) return;

  if (!payload.ok || !payload.artifacts) {
    const failureReason = payload.error ?? "Worker returned no artifacts";
    await prisma.job.update({
      where: { id: payload.jobId },
      data: {
        status: "failed",
        riskFlags: { failureReason },
      },
    });
    return;
  }

  const artifacts = payload.artifacts;

  const gateInput: GateInput = {
    confidenceScore: artifacts.confidence_score,
    diffLinesChanged: artifacts.diff.split("\n").length,
    tier: job.user.tier,
    repoArchived: job.issue.repository.isArchived,
    lastMaintainerActivityAt: job.issue.repository.lastMaintainerActivityAt,
    riskFlags: {
      secretsDetected: artifacts.risk_flags.some((f) =>
        f.toLowerCase().includes("secret")
      ),
      testsFailed: artifacts.test_results.toLowerCase().includes("failed"),
    },
  };

  const gateResult = evaluateGate(gateInput);

  if (!gateResult.passed) {
    await prisma.job.update({
      where: { id: payload.jobId },
      data: {
        status: "failed",
        confidenceScore: artifacts.confidence_score,
        diffLinesChanged: artifacts.changed_files.length,
        riskFlags: {
          failureReason: gateResult.reason ?? "Failed quality gates",
          gateFailure: gateResult.reason ?? "Failed quality gates",
        },
      },
    });
    return;
  }

  await prisma.$transaction([
    prisma.job.update({
      where: { id: payload.jobId },
      data: {
        status: "review_pending",
        confidenceScore: artifacts.confidence_score,
        diffLinesChanged: artifacts.changed_files.length,
        artifactKeys: {
          diff_key: `jobs/${payload.jobId}/diff.patch`,
          trace_key: `jobs/${payload.jobId}/trace.log`,
          summary_key: artifacts.summary,
          test_key: `jobs/${payload.jobId}/tests.log`,
        },
        riskFlags: artifacts.risk_flags.length > 0
          ? { flags: artifacts.risk_flags }
          : undefined,
      },
    }),
    prisma.review.create({
      data: {
        jobId: payload.jobId,
        userId: job.userId,
        screen1State: "not_started",
        questionsPayload: undefined,
      },
    }),
  ]);
}

/** Check for timed-out jobs and mark them as failed. */
export async function processTimedOutJobs(): Promise<number> {
  const threshold = new Date(Date.now() - JOB_TIMEOUT_MS);

  const result = await prisma.job.updateMany({
    where: {
      status: "running",
      updatedAt: { lt: threshold },
    },
    data: {
      status: "failed",
      riskFlags: {
        failureReason: `Timed out after ${Math.round(
          JOB_TIMEOUT_MS / 60000
        )} minutes`,
      },
    },
  });

  return result.count;
}

import { prisma } from "../../lib/prisma.js";
import {
  createGitHubClient,
  fetchRepoIssues,
  type FetchIssuesResult,
} from "../../lib/github.client.js";
import {
  computeFixabilityScore,
  computeRepoHealthScore,
  computeReputationValueScore,
  computeCompositeScore,
  computePrestigeTier,
  computeIssueTier,
  type PrestigeTierName,
} from "../matching/scoring.engine.js";
import { ok, err } from "../../common/types/result.js";
import type { Result } from "../../common/types/result.js";
import { notFound, validationError } from "../../common/errors/app-error.js";
import pino from "pino";

const logger = pino({ name: "issue-sync" });

export interface SyncResult {
  repoId: string;
  repoFullName: string;
  issuesFetched: number;
  issuesUpserted: number;
  issuesClosed: number;
  skipped: boolean;
  durationMs: number;
  error?: string;
}

const DEFAULT_FIT_SCORE = 50;

function sanitizeUtf8(str: string | null): string | null {
  if (!str) return str;
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x00/g, "");
}

const REPRO_PATTERNS = [
  "steps to reproduce",
  "reproduction steps",
  "how to reproduce",
  "to reproduce",
  "expected behavior",
  "actual behavior",
];

function detectReproSteps(body: string | null): boolean {
  if (!body) return false;
  const lower = body.toLowerCase();
  return REPRO_PATTERNS.some((p) => lower.includes(p));
}

export async function syncRepoIssues(
  repoId: string
): Promise<Result<SyncResult>> {
  const start = Date.now();

  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (!repo) return err(notFound(`Repository ${repoId} not found`));
  if (repo.allowlistState !== "approved") {
    return err(validationError(`Repository ${repo.fullName} is not approved`));
  }

  const [owner, repoName] = repo.fullName.split("/");
  if (!owner || !repoName) {
    return err(validationError(`Invalid fullName format: ${repo.fullName}`));
  }

  const client = createGitHubClient();
  const fetchResult = await fetchRepoIssues(
    client,
    owner,
    repoName,
    repo.syncEtag
  );

  if (!fetchResult.ok) {
    if (fetchResult.error.code === "NOT_FOUND") {
      await prisma.repository.update({
        where: { id: repoId },
        data: { isArchived: true },
      });
      logger.warn(
        `[issue-sync] repo=${repo.fullName} archived (GitHub 404)`
      );
    }
    return ok({
      repoId,
      repoFullName: repo.fullName,
      issuesFetched: 0,
      issuesUpserted: 0,
      issuesClosed: 0,
      skipped: false,
      durationMs: Date.now() - start,
      error: fetchResult.error.message,
    });
  }

  const data: FetchIssuesResult | null = fetchResult.data;
  if (data === null) {
    logger.info(
      `[issue-sync] repo=${repo.fullName} skipped (304 Not Modified)`
    );
    return ok({
      repoId,
      repoFullName: repo.fullName,
      issuesFetched: 0,
      issuesUpserted: 0,
      issuesClosed: 0,
      skipped: true,
      durationMs: Date.now() - start,
    });
  }

  const lastActivityDays = repo.lastMaintainerActivityAt
    ? Math.floor(
        (Date.now() - repo.lastMaintainerActivityAt.getTime()) /
          (1000 * 60 * 60 * 24)
      )
    : null;

  const repoHealthScore = computeRepoHealthScore(
    repo.starCount,
    repo.maintainerActivityScore,
    repo.isArchived,
    lastActivityDays
  );

  const hasAnyGoodFirstIssue = data.issues.some((i) =>
    i.labels.some((l) => l.toLowerCase() === "good first issue")
  );
  const autoPrestige = computePrestigeTier(
    repo.starCount,
    data.issues.length,
    hasAnyGoodFirstIssue,
  );

  if (repo.prestigeTier !== autoPrestige) {
    const scoreMap: Record<string, number> = { entry: 25, mid: 50, high: 75, prestige: 100 };
    await prisma.repository.update({
      where: { id: repoId },
      data: {
        prestigeTier: autoPrestige,
        prestigeScore: scoreMap[autoPrestige] ?? 25,
      },
    });
    logger.info(
      `[issue-sync] repo=${repo.fullName} prestige auto-upgraded: ${repo.prestigeTier} → ${autoPrestige} (stars=${repo.starCount})`
    );
  }

  const effectivePrestige: PrestigeTierName = autoPrestige;

  const reputationValueScore = computeReputationValueScore(
    effectivePrestige,
    1
  );

  let issuesUpserted = 0;
  const fetchedGithubIds = new Set<number>();

  for (const issue of data.issues) {
    fetchedGithubIds.add(issue.number);

    const safeTitle = sanitizeUtf8(issue.title) ?? "";
    const safeBody = sanitizeUtf8(issue.body);
    const safeLabels = issue.labels.map((l) => sanitizeUtf8(l) ?? l);

    const hasLabels = safeLabels.length > 0;
    const hasReproSteps = detectReproSteps(safeBody);
    const bodyLength = safeBody?.length ?? 0;
    const isGoodFirstIssue = safeLabels.some(
      (l) => l.toLowerCase() === "good first issue"
    );

    const fixabilityScore = computeFixabilityScore(
      hasLabels,
      hasReproSteps,
      bodyLength,
      isGoodFirstIssue
    );

    const minimumTier = computeIssueTier(
      effectivePrestige,
      safeLabels,
      bodyLength,
    );

    const compositeScore = computeCompositeScore({
      fixabilityScore,
      fitScore: DEFAULT_FIT_SCORE,
      repoHealthScore,
      reputationValueScore,
    });

    await prisma.issue.upsert({
      where: {
        repositoryId_githubIssueId: {
          repositoryId: repoId,
          githubIssueId: issue.number,
        },
      },
      create: {
        repositoryId: repoId,
        githubIssueId: issue.number,
        title: safeTitle,
        body: safeBody,
        labels: safeLabels,
        htmlUrl: issue.html_url,
        state: issue.state,
        githubCreatedAt: new Date(issue.created_at),
        githubUpdatedAt: new Date(issue.updated_at),
        minimumTier,
        fixabilityScore,
        fitScore: DEFAULT_FIT_SCORE,
        repoHealthScore,
        reputationValueScore,
        compositeScore,
        claimStatus: "available",
      },
      update: {
        title: safeTitle,
        body: safeBody,
        labels: safeLabels,
        htmlUrl: issue.html_url,
        state: issue.state,
        githubUpdatedAt: new Date(issue.updated_at),
        minimumTier,
        fixabilityScore,
        fitScore: DEFAULT_FIT_SCORE,
        repoHealthScore,
        reputationValueScore,
        compositeScore,
      },
    });

    issuesUpserted++;
  }

  // Detect closed issues: DB issues for this repo that are available/expired
  // but not in the GitHub response (meaning they were closed or removed)
  const dbIssues = await prisma.issue.findMany({
    where: {
      repositoryId: repoId,
      claimStatus: { in: ["available", "expired"] },
    },
    select: { id: true, githubIssueId: true },
  });

  const toClose = dbIssues.filter(
    (i) => !fetchedGithubIds.has(i.githubIssueId)
  );
  const issuesClosed = toClose.length;

  if (toClose.length > 0) {
    await prisma.issue.updateMany({
      where: { id: { in: toClose.map((i) => i.id) } },
      data: { claimStatus: "closed", state: "closed" },
    });
  }

  await prisma.repository.update({
    where: { id: repoId },
    data: {
      lastSyncedAt: new Date(),
      syncEtag: data.etag,
    },
  });

  const durationMs = Date.now() - start;
  logger.info(
    `[issue-sync] repo=${repo.fullName} fetched=${data.issues.length} upserted=${issuesUpserted} closed=${issuesClosed} duration=${durationMs}ms`
  );

  return ok({
    repoId,
    repoFullName: repo.fullName,
    issuesFetched: data.issues.length,
    issuesUpserted,
    issuesClosed,
    skipped: false,
    durationMs,
  });
}

export async function syncAllApprovedRepos(): Promise<SyncResult[]> {
  const env = await import("../../common/config/env.js").then((m) =>
    m.getEnv()
  );
  if (!env.GITHUB_PAT) {
    logger.info("[issue-sync] GITHUB_PAT not set, skipping sync cycle");
    return [];
  }

  const repos = await prisma.repository.findMany({
    where: { allowlistState: "approved", isArchived: false },
    orderBy: { fullName: "asc" },
  });

  if (repos.length === 0) {
    logger.info("[issue-sync] No approved repos to sync");
    return [];
  }

  logger.info(
    `[issue-sync] Starting sync cycle for ${repos.length} repos`
  );
  const results: SyncResult[] = [];

  for (const repo of repos) {
    const result = await syncRepoIssues(repo.id);
    results.push(result.ok ? result.data : {
      repoId: repo.id,
      repoFullName: repo.fullName,
      issuesFetched: 0,
      issuesUpserted: 0,
      issuesClosed: 0,
      skipped: false,
      durationMs: 0,
      error: result.ok ? undefined : result.error.message,
    });
  }

  const totalFetched = results.reduce((s, r) => s + r.issuesFetched, 0);
  const totalUpserted = results.reduce((s, r) => s + r.issuesUpserted, 0);
  const totalClosed = results.reduce((s, r) => s + r.issuesClosed, 0);
  const totalErrors = results.filter((r) => r.error).length;

  logger.info(
    `[issue-sync] Cycle complete: repos=${repos.length} fetched=${totalFetched} upserted=${totalUpserted} closed=${totalClosed} errors=${totalErrors}`
  );

  return results;
}

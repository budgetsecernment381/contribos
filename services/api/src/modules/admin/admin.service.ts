import { prisma } from "../../lib/prisma.js";
import { getRedis } from "../../lib/redis.js";
import type { Result } from "../../common/types/result.js";
import { ok, err } from "../../common/types/result.js";
import { notFound, validationError } from "../../common/errors/app-error.js";
import { getSyncQueue } from "../../lib/sync-queue.js";
import { computePrestigeTier, computeIssueTier } from "../matching/scoring.engine.js";
import type { AllowlistState, PrestigeTier, Repository, UserRole, PlanTier } from "@prisma/client";

export interface RepoListItem {
  id: string;
  fullName: string;
  ecosystem: string;
  allowlistState: AllowlistState;
  prestigeTier: PrestigeTier;
}

export interface AddRepoInput {
  githubRepoId: number;
  fullName: string;
  ecosystem: string;
  allowlistState?: AllowlistState;
}

/**
 * List managed repositories.
 */
export async function listRepos(): Promise<Result<RepoListItem[]>> {
  const repos = await prisma.repository.findMany({
    orderBy: { fullName: "asc" },
  });

  return ok(
    repos.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      ecosystem: r.ecosystem,
      allowlistState: r.allowlistState,
      prestigeTier: r.prestigeTier,
    }))
  );
}

/**
 * Add or update repository allowlist.
 */
export async function addOrUpdateRepo(
  input: AddRepoInput
): Promise<Result<RepoListItem>> {
  const repo = await prisma.repository.upsert({
    where: { githubRepoId: input.githubRepoId },
    create: {
      githubRepoId: input.githubRepoId,
      fullName: input.fullName,
      ecosystem: input.ecosystem,
      allowlistState: input.allowlistState ?? "approved",
    },
    update: {
      fullName: input.fullName,
      ecosystem: input.ecosystem,
      ...(input.allowlistState && { allowlistState: input.allowlistState }),
    },
  });

  return ok({
    id: repo.id,
    fullName: repo.fullName,
    ecosystem: repo.ecosystem,
    allowlistState: repo.allowlistState,
    prestigeTier: repo.prestigeTier,
  });
}

/**
 * Update prestige graph (store in Redis for runtime config).
 */
export async function updatePrestigeGraph(
  updates: Array<{ repoId: string; prestigeTier: PrestigeTier; prestigeScore: number }>
): Promise<Result<void>> {
  for (const u of updates) {
    await prisma.repository.update({
      where: { id: u.repoId },
      data: {
        prestigeTier: u.prestigeTier,
        prestigeScore: u.prestigeScore,
      },
    });
  }
  return ok(undefined);
}

/**
 * Get current policy parameters from Redis (with defaults).
 */
export async function getPolicy(): Promise<Result<Required<PolicyParams>>> {
  const redis = getRedis();
  const raw = await redis.get("policy:params");
  if (!raw) return ok({ ...POLICY_DEFAULTS });
  const parsed = JSON.parse(raw) as PolicyParams;
  return ok({ ...POLICY_DEFAULTS, ...parsed });
}

export interface PolicyParams {
  maxClaimsPerUser?: number;
  reviewTimeoutHours?: number;
  minTierForPrestige?: number;
}

const POLICY_DEFAULTS: Required<PolicyParams> = {
  maxClaimsPerUser: 5,
  reviewTimeoutHours: 48,
  minTierForPrestige: 1,
};

/**
 * Update policy parameters (merge with existing, store in Redis).
 */
export async function updatePolicy(
  params: PolicyParams
): Promise<Result<void>> {
  const redis = getRedis();
  const existing = await redis.get("policy:params");
  const current = existing ? JSON.parse(existing) as PolicyParams : { ...POLICY_DEFAULTS };
  const merged = { ...current, ...params };
  await redis.set("policy:params", JSON.stringify(merged));
  return ok(undefined);
}

/**
 * Approve a pending repository and enqueue an immediate sync job.
 */
export async function approveRepo(repoId: string): Promise<Result<Repository>> {
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (!repo) return err(notFound(`Repository ${repoId} not found`));
  if (repo.allowlistState === "rejected") {
    return err(validationError(`Repository is rejected — unreject it first`));
  }

  if (repo.allowlistState === "approved") {
    return ok(repo);
  }

  const updated = await prisma.repository.update({
    where: { id: repoId },
    data: { allowlistState: "approved" },
  });

  const queue = getSyncQueue();
  await queue.add("sync-repo", { repoId }, { jobId: `sync-${repoId}-${Date.now()}` });
  console.log(`[admin] Approved repo ${repo.fullName} and enqueued sync`);

  return ok(updated);
}

/**
 * Reject a pending repository.
 */
export async function rejectRepo(repoId: string): Promise<Result<Repository>> {
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (!repo) return err(notFound(`Repository ${repoId} not found`));
  if (repo.allowlistState === "approved") {
    return err(validationError(`Repository is already approved — cannot reject`));
  }

  if (repo.allowlistState === "rejected") {
    return ok(repo);
  }

  const updated = await prisma.repository.update({
    where: { id: repoId },
    data: { allowlistState: "rejected" },
  });

  console.log(`[admin] Rejected repo ${repo.fullName}`);
  return ok(updated);
}

/**
 * Manually trigger an issue sync for an approved repository.
 */
export async function triggerRepoSync(repoId: string): Promise<Result<{ jobId: string }>> {
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (!repo) return err(notFound(`Repository ${repoId} not found`));
  if (repo.allowlistState !== "approved") {
    return err(validationError(`Repository ${repo.fullName} is not approved`));
  }

  const queue = getSyncQueue();
  const jobId = `sync-${repoId}-${Date.now()}`;
  await queue.add("sync-repo", { repoId }, { jobId });
  console.log(`[admin] Manual sync triggered for ${repo.fullName}, jobId=${jobId}`);

  return ok({ jobId });
}

// --- User management ---

export interface AdminUserItem {
  id: string;
  githubUsername: string;
  email: string | null;
  avatarUrl: string | null;
  role: UserRole;
  tier: number;
  creditBalance: number;
  planTier: PlanTier;
  onboardingComplete: boolean;
  createdAt: Date;
}

export async function listUsers(): Promise<Result<AdminUserItem[]>> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
  });

  return ok(
    users.map((u) => ({
      id: u.id,
      githubUsername: u.githubUsername,
      email: u.email,
      avatarUrl: u.avatarUrl,
      role: u.role,
      tier: u.tier,
      creditBalance: u.creditBalance,
      planTier: u.planTier,
      onboardingComplete: u.onboardingComplete,
      createdAt: u.createdAt,
    }))
  );
}

export async function updateUserCredits(
  userId: string,
  amount: number,
  reason: string
): Promise<Result<{ creditBalance: number }>> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return err(notFound(`User ${userId} not found`));

  const newBalance = user.creditBalance + amount;
  if (newBalance < 0) {
    return err(validationError("Resulting balance would be negative"));
  }

  await prisma.$transaction([
    prisma.creditTransaction.create({
      data: {
        userId,
        transactionType: amount > 0 ? "plan_grant" : "refund",
        amount,
        balanceAfter: newBalance,
        referenceId: `admin:${reason}`,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { creditBalance: newBalance },
    }),
  ]);

  return ok({ creditBalance: newBalance });
}

// --- Prestige backfill ---

export interface BackfillResult {
  reposUpdated: number;
  issuesUpdated: number;
  tierDistribution: Record<string, number>;
}

export async function backfillPrestigeTiers(): Promise<Result<BackfillResult>> {
  const repos = await prisma.repository.findMany({
    where: { allowlistState: "approved", isArchived: false },
    select: { id: true, fullName: true, starCount: true, prestigeTier: true },
  });

  let reposUpdated = 0;
  let issuesUpdated = 0;
  const tierDistribution: Record<string, number> = { entry: 0, mid: 0, high: 0, prestige: 0 };

  for (const repo of repos) {
    const issueCount = await prisma.issue.count({
      where: { repositoryId: repo.id, claimStatus: "available" },
    });
    const hasGoodFirst = await prisma.issue.count({
      where: {
        repositoryId: repo.id,
        claimStatus: "available",
        labels: { has: "good first issue" },
      },
    });

    const newPrestige = computePrestigeTier(repo.starCount, issueCount, hasGoodFirst > 0);
    tierDistribution[newPrestige] = (tierDistribution[newPrestige] ?? 0) + 1;

    if (repo.prestigeTier !== newPrestige) {
      await prisma.repository.update({
        where: { id: repo.id },
        data: { prestigeTier: newPrestige },
      });
      reposUpdated++;
    }

    const issues = await prisma.issue.findMany({
      where: { repositoryId: repo.id, state: "open" },
      select: { id: true, labels: true, body: true, minimumTier: true },
    });

    for (const issue of issues) {
      const bodyLen = issue.body?.length ?? 0;
      const newTier = computeIssueTier(newPrestige, issue.labels, bodyLen);

      if (issue.minimumTier !== newTier) {
        await prisma.issue.update({
          where: { id: issue.id },
          data: { minimumTier: newTier },
        });
        issuesUpdated++;
      }
    }
  }

  console.log(
    `[backfill] Prestige tiers recalculated: ${reposUpdated} repos updated, ${issuesUpdated} issues re-tiered, distribution=${JSON.stringify(tierDistribution)}`
  );

  return ok({ reposUpdated, issuesUpdated, tierDistribution });
}

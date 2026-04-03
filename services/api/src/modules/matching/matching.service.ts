import { prisma } from "../../lib/prisma.js";
import type { Result } from "../../common/types/result.js";
import { ok, err } from "../../common/types/result.js";
import {
  notFound,
  forbidden,
  claimConflict,
  validationError,
} from "../../common/errors/app-error.js";
import { ClaimStatus, Prisma } from "@prisma/client";
import { checkClaimLimit } from "./claim.service.js";

export interface RecommendedIssue {
  id: string;
  repositoryId: string;
  githubIssueId: number;
  title: string;
  complexityEstimate: string | null;
  minimumTier: number;
  fixabilityScore: number;
  fitScore: number;
  repoHealthScore: number;
  reputationValueScore: number;
  compositeScore: number;
  claimStatus: ClaimStatus;
  claimedByUserId: string | null;
  repoFullName: string;
  ecosystem: string;
}

export interface IssueQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  ecosystem?: string;
  tier?: number;
  sort?: "score" | "prestige" | "newest";
}

export interface PaginatedIssues {
  issues: RecommendedIssue[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Get tier-matched issue recommendations with pagination, search, and filtering.
 */
export async function getRecommendedIssues(
  userId: string,
  params: IssueQueryParams = {}
): Promise<Result<PaginatedIssues>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { ecosystems: true },
  });
  if (!user) return err(notFound("User not found"));

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.max(1, Math.min(params.limit ?? 20, 50));
  const skip = (page - 1) * pageSize;

  const userEcosystems = user.ecosystems.map((e) => e.ecosystemName);
  const tier = user.tier;

  const where: Prisma.IssueWhereInput = {
    minimumTier: { lte: params.tier ?? tier },
    claimStatus: ClaimStatus.available,
    repository: {
      allowlistState: "approved",
      isArchived: false,
      ...(params.ecosystem && params.ecosystem !== "all"
        ? { ecosystem: params.ecosystem }
        : userEcosystems.length > 0
          ? { ecosystem: { in: userEcosystems } }
          : {}),
    },
    ...(params.search && {
      OR: [
        { title: { contains: params.search, mode: "insensitive" as const } },
        { repository: { fullName: { contains: params.search, mode: "insensitive" as const } } },
      ],
    }),
  };

  const orderBy: Prisma.IssueOrderByWithRelationInput =
    params.sort === "prestige"
      ? { reputationValueScore: "desc" as const }
      : params.sort === "newest"
        ? { githubCreatedAt: "desc" as const }
        : { compositeScore: "desc" as const };

  const [issues, total] = await Promise.all([
    prisma.issue.findMany({
      where,
      include: { repository: true },
      orderBy,
      take: pageSize,
      skip,
    }),
    prisma.issue.count({ where }),
  ]);

  const result: RecommendedIssue[] = issues.map((i) => ({
    id: i.id,
    repositoryId: i.repositoryId,
    githubIssueId: i.githubIssueId,
    title: i.title,
    complexityEstimate: i.complexityEstimate,
    minimumTier: i.minimumTier,
    fixabilityScore: i.fixabilityScore,
    fitScore: i.fitScore,
    repoHealthScore: i.repoHealthScore,
    reputationValueScore: i.reputationValueScore,
    compositeScore: i.compositeScore,
    claimStatus: i.claimStatus,
    claimedByUserId: i.claimedByUserId,
    repoFullName: i.repository.fullName,
    ecosystem: i.repository.ecosystem,
  }));

  return ok({
    issues: result,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

/**
 * Get issues currently claimed by a user, with their latest job status.
 */
export async function getClaimedIssues(
  userId: string
): Promise<Result<Array<RecommendedIssue & { claimedAt: Date | null; latestJobId: string | null; latestJobStatus: string | null; latestReviewId: string | null; latestReviewPrType: string | null }>>> {
  const issues = await prisma.issue.findMany({
    where: {
      claimedByUserId: userId,
      claimStatus: "claimed",
    },
    include: {
      repository: true,
      jobs: {
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          review: { select: { id: true, screen2PrType: true } },
        },
      },
    },
    orderBy: { claimedAt: "desc" },
  });

  return ok(
    issues.map((i) => ({
      id: i.id,
      repositoryId: i.repositoryId,
      githubIssueId: i.githubIssueId,
      title: i.title,
      complexityEstimate: i.complexityEstimate,
      minimumTier: i.minimumTier,
      fixabilityScore: i.fixabilityScore,
      fitScore: i.fitScore,
      repoHealthScore: i.repoHealthScore,
      reputationValueScore: i.reputationValueScore,
      compositeScore: i.compositeScore,
      claimStatus: i.claimStatus,
      claimedByUserId: i.claimedByUserId,
      repoFullName: i.repository.fullName,
      ecosystem: i.repository.ecosystem,
      claimedAt: i.claimedAt,
      latestJobId: i.jobs[0]?.id ?? null,
      latestJobStatus: i.jobs[0]?.status ?? null,
      latestReviewId: i.jobs[0]?.review?.id ?? null,
      latestReviewPrType: i.jobs[0]?.review?.screen2PrType ?? null,
    }))
  );
}

/**
 * Claim an issue with DB transaction for claim locking.
 */
export async function claimIssue(
  userId: string,
  issueId: string
): Promise<Result<void>> {
  const withinLimit = await checkClaimLimit(userId);
  if (!withinLimit) {
    return err(validationError("Maximum 3 concurrent claims allowed"));
  }

  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    include: { repository: true },
  });
  if (!issue) return err(notFound("Issue not found"));

  if (issue.claimStatus !== ClaimStatus.available) {
    return err(claimConflict());
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return err(notFound("User not found"));
  if (user.tier < issue.minimumTier) {
    return err(validationError("User tier too low for this issue"));
  }

  if (!user.onboardingComplete) {
    return err(validationError("Complete onboarding before claiming issues"));
  }

  try {
    await prisma.$transaction(async (tx) => {
      const locked = await tx.issue.findUnique({
        where: { id: issueId },
      });
      if (!locked || locked.claimStatus !== ClaimStatus.available) {
        const err = new Error("CLAIM_CONFLICT");
        (err as Error & { code: string }).code = "CLAIM_CONFLICT";
        throw err;
      }
      await tx.issue.update({
        where: { id: issueId },
        data: {
          claimStatus: ClaimStatus.claimed,
          claimedByUserId: userId,
          claimedAt: new Date(),
        },
      });
    });
    return ok(undefined);
  } catch (e) {
    if (e instanceof Error && (e as Error & { code?: string }).code === "CLAIM_CONFLICT") {
      return err(claimConflict());
    }
    throw e;
  }
}

/**
 * Release a claim on an issue.
 */
export async function releaseClaim(
  userId: string,
  issueId: string
): Promise<Result<void>> {
  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue) return err(notFound("Issue not found"));

  if (issue.claimedByUserId !== userId) {
    return err(forbidden("You do not own this claim"));
  }

  await prisma.issue.update({
    where: { id: issueId },
    data: {
      claimStatus: ClaimStatus.available,
      claimedByUserId: null,
      claimedAt: null,
    },
  });

  return ok(undefined);
}

/**
 * Get issue detail by ID.
 */
export async function getIssue(
  _userId: string,
  issueId: string
): Promise<Result<RecommendedIssue>> {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    include: { repository: true },
  });
  if (!issue) return err(notFound("Issue not found"));

  return ok({
    id: issue.id,
    repositoryId: issue.repositoryId,
    githubIssueId: issue.githubIssueId,
    title: issue.title,
    complexityEstimate: issue.complexityEstimate,
    minimumTier: issue.minimumTier,
    fixabilityScore: issue.fixabilityScore,
    fitScore: issue.fitScore,
    repoHealthScore: issue.repoHealthScore,
    reputationValueScore: issue.reputationValueScore,
    compositeScore: issue.compositeScore,
    claimStatus: issue.claimStatus,
    claimedByUserId: issue.claimedByUserId,
    repoFullName: issue.repository.fullName,
    ecosystem: issue.repository.ecosystem,
  });
}

/**
 * Get distinct ecosystem names from approved, non-archived repositories.
 */
export async function getEcosystems(): Promise<string[]> {
  const repos = await prisma.repository.findMany({
    where: { allowlistState: "approved", isArchived: false },
    select: { ecosystem: true },
    distinct: ["ecosystem"],
    orderBy: { ecosystem: "asc" },
  });
  return repos.map((r) => r.ecosystem).filter(Boolean);
}

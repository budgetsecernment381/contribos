/**
 * Stepping-stone service — recommends progression paths from current
 * tier to higher-tier contributions with intermediate steps.
 */

import { prisma } from "../../lib/prisma.js";
import type { Result } from "../../common/types/result.js";
import { ok, err } from "../../common/types/result.js";
import { notFound } from "../../common/errors/app-error.js";

export interface SteppingStone {
  currentTier: number;
  targetTier: number;
  recommendations: StoneRecommendation[];
  progressMetrics: ProgressMetrics;
}

export interface StoneRecommendation {
  issueId: string;
  title: string;
  repoFullName: string;
  ecosystem: string;
  minimumTier: number;
  compositeScore: number;
  reason: string;
}

export interface ProgressMetrics {
  completedCycles: number;
  requiredCycles: number;
  currentChs: number;
  requiredChs: number;
  estimatedContributionsToProgress: number;
}

const TIER_REQUIREMENTS = [
  { tier: 2, minChs: 60, minCycles: 3 },
  { tier: 3, minChs: 70, minCycles: 5 },
  { tier: 4, minChs: 80, minCycles: 8 },
] as const;

/** Get stepping-stone recommendations for tier progression. */
export async function getSteppingStone(
  userId: string
): Promise<Result<SteppingStone>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { ecosystems: true },
  });
  if (!user) return err(notFound("User not found"));

  const currentTier = user.tier;
  const targetTier = Math.min(currentTier + 1, 4);

  const cycleCount = await prisma.contributionEvent.count({
    where: {
      userId,
      eventType: { in: ["merged", "merged_with_changes"] },
    },
  });

  const requirement = TIER_REQUIREMENTS.find((r) => r.tier === targetTier);
  const requiredCycles = requirement?.minCycles ?? 999;
  const requiredChs = requirement?.minChs ?? 100;

  const ecosystemNames = user.ecosystems.map((e) => e.ecosystemName);

  const issues = await prisma.issue.findMany({
    where: {
      minimumTier: { lte: currentTier },
      claimStatus: "available",
      repository: {
        allowlistState: "approved",
        isArchived: false,
        ...(ecosystemNames.length > 0
          ? { ecosystem: { in: ecosystemNames } }
          : {}),
      },
    },
    include: { repository: true },
    orderBy: { compositeScore: "desc" },
    take: 5,
  });

  const recommendations: StoneRecommendation[] = issues.map((issue) => ({
    issueId: issue.id,
    title: issue.title,
    repoFullName: issue.repository.fullName,
    ecosystem: issue.repository.ecosystem,
    minimumTier: issue.minimumTier,
    compositeScore: issue.compositeScore,
    reason:
      issue.minimumTier === currentTier
        ? "Matches your current tier — build momentum"
        : "Slightly below your tier — quick confidence builder",
  }));

  const remainingCycles = Math.max(0, requiredCycles - cycleCount);
  const chsGap = Math.max(0, requiredChs - user.contributionHealthScore);

  return ok({
    currentTier,
    targetTier,
    recommendations,
    progressMetrics: {
      completedCycles: cycleCount,
      requiredCycles,
      currentChs: user.contributionHealthScore,
      requiredChs,
      estimatedContributionsToProgress: Math.max(remainingCycles, Math.ceil(chsGap / 5)),
    },
  });
}

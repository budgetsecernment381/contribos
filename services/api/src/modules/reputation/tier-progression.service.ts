/**
 * Tier progression service — evaluates tier advancement and regression rules.
 */

import { prisma } from "../../lib/prisma.js";
import type { Result } from "../../common/types/result.js";
import { ok, err } from "../../common/types/result.js";
import { notFound } from "../../common/errors/app-error.js";

const TIER_THRESHOLDS = [
  { from: 1, to: 2, minChs: 60, minCycles: 3 },
  { from: 2, to: 3, minChs: 70, minCycles: 5 },
  { from: 3, to: 4, minChs: 80, minCycles: 8 },
] as const;

const REGRESSION_THRESHOLD = 3;
export const REGRESSION_MIN_CHS_DROP = 15;

export interface ProgressionResult {
  currentTier: number;
  newTier: number;
  changed: boolean;
  reason: string | null;
  meetsRequirements: boolean;
  progress: {
    chs: number;
    requiredChs: number;
    cycles: number;
    requiredCycles: number;
  };
}

/** Evaluate tier progression for a user. */
export async function evaluateProgression(
  userId: string
): Promise<Result<ProgressionResult>> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return err(notFound("User not found"));

  const cycleCount = await prisma.contributionEvent.count({
    where: {
      userId,
      eventType: { in: ["merged", "merged_with_changes"] },
    },
  });

  const currentTier = user.tier;
  const threshold = TIER_THRESHOLDS.find((t) => t.from === currentTier);

  if (!threshold) {
    return ok({
      currentTier,
      newTier: currentTier,
      changed: false,
      reason: currentTier >= 4 ? "Maximum tier reached" : null,
      meetsRequirements: currentTier >= 4,
      progress: {
        chs: user.contributionHealthScore,
        requiredChs: 100,
        cycles: cycleCount,
        requiredCycles: 999,
      },
    });
  }

  const meetsChs = user.contributionHealthScore >= threshold.minChs;
  const meetsCycles = cycleCount >= threshold.minCycles;

  if (meetsChs && meetsCycles) {
    await prisma.user.update({
      where: { id: userId },
      data: { tier: threshold.to },
    });

    return ok({
      currentTier,
      newTier: threshold.to,
      changed: true,
      reason: `CHS ${user.contributionHealthScore} >= ${threshold.minChs} with ${cycleCount} cycles (min ${threshold.minCycles})`,
      meetsRequirements: true,
      progress: {
        chs: user.contributionHealthScore,
        requiredChs: threshold.minChs,
        cycles: cycleCount,
        requiredCycles: threshold.minCycles,
      },
    });
  }

  return ok({
    currentTier,
    newTier: currentTier,
    changed: false,
    reason: null,
    meetsRequirements: false,
    progress: {
      chs: user.contributionHealthScore,
      requiredChs: threshold.minChs,
      cycles: cycleCount,
      requiredCycles: threshold.minCycles,
    },
  });
}

/** Check for tier regression: consecutive negative events. */
export async function checkRegression(
  userId: string
): Promise<{ shouldRegress: boolean; reason: string | null }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.tier <= 1) {
    return { shouldRegress: false, reason: null };
  }

  const recentEvents = await prisma.contributionEvent.findMany({
    where: { userId },
    orderBy: { occurredAt: "desc" },
    take: REGRESSION_THRESHOLD,
  });

  if (recentEvents.length < REGRESSION_THRESHOLD) {
    return { shouldRegress: false, reason: null };
  }

  const allNegative = recentEvents.every(
    (e) => e.chsDelta < 0 || e.chsValueMultiplier < 0.5
  );

  if (allNegative) {
    return {
      shouldRegress: true,
      reason: `${REGRESSION_THRESHOLD} consecutive negative contribution events`,
    };
  }

  return { shouldRegress: false, reason: null };
}

/** Apply tier regression by demoting one tier. */
export async function applyRegression(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.tier <= 1) return;

  await prisma.user.update({
    where: { id: userId },
    data: { tier: user.tier - 1 },
  });
}

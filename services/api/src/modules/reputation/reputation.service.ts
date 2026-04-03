import { prisma } from "../../lib/prisma.js";
import type { Result } from "../../common/types/result.js";
import { ok, err } from "../../common/types/result.js";
import { notFound, forbidden } from "../../common/errors/app-error.js";
import { computeChs, scoreReviewTime, type ChsSignals } from "./chs.engine.js";
import {
  evaluateProgression,
  checkRegression as checkTierRegression,
  applyRegression,
} from "./tier-progression.service.js";

/** Gathers raw signal data from the database for CHS calculation. */
async function gatherSignals(userId: string): Promise<ChsSignals> {
  const [prs, reviews, inboxItems] = await Promise.all([
    prisma.pullRequest.findMany({
      where: { userId },
      select: {
        state: true,
        changesRequested: true,
        maintainerSentimentScore: true,
      },
    }),
    prisma.review.findMany({
      where: { userId },
      select: {
        comprehensionScore: true,
        createdAt: true,
        approvalTimestamp: true,
      },
    }),
    prisma.pRInboxItem.findMany({
      where: { userId },
      select: { isAcknowledged: true },
    }),
  ]);

  const totalPrs = prs.length || 1;
  const mergedPrs = prs.filter((p) => p.state === "merged");
  const mergedClean = mergedPrs.filter((p) => !p.changesRequested).length;
  const prMergedCleanRate = (mergedClean / totalPrs) * 100;

  const sentimentScores = prs
    .map((p) => p.maintainerSentimentScore)
    .filter((s): s is number => s !== null);
  const avgMaintainerSentiment =
    sentimentScores.length > 0
      ? (sentimentScores.reduce((a, b) => a + b, 0) / sentimentScores.length) * 100
      : 50;

  const totalInbox = inboxItems.length || 1;
  const acknowledged = inboxItems.filter((i) => i.isAcknowledged).length;
  const commentResponseRate = (acknowledged / totalInbox) * 100;

  const reviewTimes = reviews
    .filter((r) => r.approvalTimestamp)
    .map((r) => {
      const diff = r.approvalTimestamp!.getTime() - r.createdAt.getTime();
      return scoreReviewTime(diff / 60000);
    });
  const avgReviewTimeScore =
    reviewTimes.length > 0
      ? reviewTimes.reduce((a, b) => a + b, 0) / reviewTimes.length
      : 50;

  const mergeRate = (mergedPrs.length / totalPrs) * 100;

  const comprehensionScores = reviews
    .map((r) => r.comprehensionScore)
    .filter((s): s is number => s !== null);
  const avgComprehension =
    comprehensionScores.length > 0
      ? comprehensionScores.reduce((a, b) => a + b, 0) / comprehensionScores.length
      : 50;

  return {
    prMergedCleanRate,
    avgMaintainerSentiment,
    commentResponseRate,
    avgReviewTimeScore,
    mergeRate,
    avgComprehension,
  };
}

/** Returns current CHS, tier, cycle count, and any pending tier changes. */
export async function getReputationScore(
  userId: string
): Promise<
  Result<{
    contributionHealthScore: number;
    tier: number;
    cycleCount: number;
    signals: ChsSignals;
    pendingProgression: { newTier: number; reason: string } | null;
    regressionRisk: boolean;
  }>
> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return err(notFound("User not found"));

  const signals = await gatherSignals(userId);
  const computedChs = computeChs(signals);

  const cycleCount = await prisma.contributionEvent.count({
    where: { userId, eventType: { in: ["merged", "merged_with_changes"] } },
  });

  const progressionResult = await evaluateProgression(userId);
  const newTier = progressionResult.ok ? progressionResult.data.newTier : user.tier;
  let reason: string | null = null;
  if (progressionResult.ok && progressionResult.data.changed) {
    reason = progressionResult.data.reason;
  }
  const regressionCheck = await checkTierRegression(userId);
  const regressionRisk = regressionCheck.shouldRegress;

  return ok({
    contributionHealthScore: computedChs,
    tier: user.tier,
    cycleCount,
    signals,
    pendingProgression: reason ? { newTier, reason } : null,
    regressionRisk,
  });
}

/** Returns CHS event history ordered by most recent. */
export async function getReputationHistory(
  userId: string,
  limit = 50
): Promise<
  Result<
    Array<{
      id: string;
      eventType: string;
      chsDelta: number;
      chsValueMultiplier: number;
      occurredAt: Date;
      pullRequestId: string;
    }>
  >
> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return err(notFound("User not found"));

  const events = await prisma.contributionEvent.findMany({
    where: { userId },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });

  return ok(
    events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      chsDelta: e.chsDelta,
      chsValueMultiplier: e.chsValueMultiplier,
      occurredAt: e.occurredAt,
      pullRequestId: e.pullRequestId,
    }))
  );
}

/** Applies a contribution event and recalculates CHS and tier. */
export async function applyContributionEvent(
  userId: string,
  pullRequestId: string,
  eventType: "merged" | "merged_with_changes" | "closed" | "abandoned" | "comment_response" | "review_completed",
  chsDelta: number
): Promise<Result<{ newChs: number; newTier: number; tierChanged: boolean }>> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return err(notFound("User not found"));

  const pr = await prisma.pullRequest.findUnique({
    where: { id: pullRequestId },
    select: { userId: true },
  });
  if (!pr) return err(notFound("Pull request not found"));
  if (pr.userId !== userId) {
    return err(forbidden("You do not own this pull request"));
  }

  let multiplier = 1;
  if (eventType === "merged_with_changes") {
    multiplier = 0.8;
  }

  await prisma.contributionEvent.create({
    data: {
      userId,
      pullRequestId,
      eventType,
      chsDelta,
      chsValueMultiplier: multiplier,
      occurredAt: new Date(),
    },
  });

  const signals = await gatherSignals(userId);
  const newChs = computeChs(signals);

  const progressionCheck = await evaluateProgression(userId);
  const newTier = progressionCheck.ok ? progressionCheck.data.newTier : user.tier;
  const tierChanged = newTier !== user.tier;

  const regressionCheck = await checkTierRegression(userId);
  if (regressionCheck.shouldRegress && !tierChanged) {
    await applyRegression(userId);
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      contributionHealthScore: newChs,
      ...(tierChanged ? { tier: newTier } : {}),
    },
  });

  return ok({ newChs, newTier, tierChanged });
}

/**
 * Contribution Health Score engine — extracts the pure CHS computation
 * from the reputation service for testability and reuse.
 *
 * CHS = PR merge quality × 0.25 + maintainer sentiment × 0.20 +
 *        comment response × 0.15 + review time × 0.15 +
 *        merge rate × 0.15 + comprehension × 0.10
 */

export interface ChsSignals {
  prMergedCleanRate: number;
  avgMaintainerSentiment: number;
  commentResponseRate: number;
  avgReviewTimeScore: number;
  mergeRate: number;
  avgComprehension: number;
}

export const CHS_WEIGHTS = {
  prMergedClean: 0.25,
  maintainerSentiment: 0.20,
  commentResponse: 0.15,
  reviewTime: 0.15,
  mergeRate: 0.15,
  comprehension: 0.10,
} as const;

/** Compute CHS from 6 weighted signals, clamped to [0, 100]. */
export function computeChs(signals: ChsSignals): number {
  const raw =
    signals.prMergedCleanRate * CHS_WEIGHTS.prMergedClean +
    signals.avgMaintainerSentiment * CHS_WEIGHTS.maintainerSentiment +
    signals.commentResponseRate * CHS_WEIGHTS.commentResponse +
    signals.avgReviewTimeScore * CHS_WEIGHTS.reviewTime +
    signals.mergeRate * CHS_WEIGHTS.mergeRate +
    signals.avgComprehension * CHS_WEIGHTS.comprehension;

  return Math.round(Math.max(0, Math.min(100, raw)));
}

/** Map review completion time to a 0-100 score. */
export function scoreReviewTime(minutesToComplete: number): number {
  if (minutesToComplete < 2) return 30;
  if (minutesToComplete < 5) return 60;
  if (minutesToComplete < 15) return 90;
  return 100;
}

/** Detect momentum trend: positive, stable, or declining. */
export function detectTrend(
  recentDeltas: number[]
): "positive" | "stable" | "declining" {
  if (recentDeltas.length < 3) return "stable";

  const last3 = recentDeltas.slice(0, 3);
  const avgDelta = last3.reduce((a, b) => a + b, 0) / last3.length;

  if (avgDelta > 2) return "positive";
  if (avgDelta < -2) return "declining";
  return "stable";
}

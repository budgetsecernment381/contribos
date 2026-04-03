/**
 * Scoring engine — computes composite issue-user fit scores.
 * Composite = fixability×0.30 + fit×0.25 + repo_health×0.25 + reputation_value×0.20
 */

export interface ScoringInput {
  fixabilityScore: number;
  fitScore: number;
  repoHealthScore: number;
  reputationValueScore: number;
}

export interface ScoringWeights {
  fixability: number;
  fit: number;
  repoHealth: number;
  reputationValue: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  fixability: 0.30,
  fit: 0.25,
  repoHealth: 0.25,
  reputationValue: 0.20,
};

/** Compute composite score from weighted sub-scores. */
export function computeCompositeScore(
  input: ScoringInput,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): number {
  const raw =
    input.fixabilityScore * weights.fixability +
    input.fitScore * weights.fit +
    input.repoHealthScore * weights.repoHealth +
    input.reputationValueScore * weights.reputationValue;

  return Math.round(Math.max(0, Math.min(100, raw)) * 100) / 100;
}

/** Compute fixability score based on issue characteristics. */
export function computeFixabilityScore(
  hasLabels: boolean,
  hasReproSteps: boolean,
  bodyLength: number,
  isGoodFirstIssue: boolean
): number {
  let score = 40;
  if (hasLabels) score += 15;
  if (hasReproSteps) score += 20;
  if (bodyLength > 200) score += 10;
  if (isGoodFirstIssue) score += 15;
  return Math.min(100, score);
}

/** Compute fit score between user ecosystem and issue ecosystem. */
export function computeFitScore(
  userEcosystems: string[],
  issueEcosystem: string,
  userTier: number,
  issueTier: number
): number {
  let score = 30;

  if (userEcosystems.includes(issueEcosystem)) {
    score += 35;
  }

  const tierDiff = Math.abs(userTier - issueTier);
  if (tierDiff === 0) score += 25;
  else if (tierDiff === 1) score += 15;
  else score += 5;

  return Math.min(100, score);
}

/** Compute repo health score from repository signals. */
export function computeRepoHealthScore(
  starCount: number,
  maintainerActivityScore: number,
  isArchived: boolean,
  lastMaintainerActivityDays: number | null
): number {
  if (isArchived) return 0;

  let score = 20;

  if (starCount >= 10000) score += 30;
  else if (starCount >= 1000) score += 25;
  else if (starCount >= 100) score += 15;

  score += Math.min(30, maintainerActivityScore * 30);

  if (lastMaintainerActivityDays !== null) {
    if (lastMaintainerActivityDays <= 7) score += 20;
    else if (lastMaintainerActivityDays <= 30) score += 15;
    else if (lastMaintainerActivityDays <= 90) score += 5;
  }

  return Math.min(100, score);
}

/** Compute reputation value score. */
export function computeReputationValueScore(
  prestigeTier: string,
  ecosystemDepth: number
): number {
  const tierMap: Record<string, number> = {
    entry: 20,
    mid: 45,
    high: 70,
    prestige: 95,
  };

  const base = tierMap[prestigeTier] ?? 20;
  const depthBonus = Math.min(20, ecosystemDepth * 5);
  return Math.min(100, base + depthBonus);
}

/**
 * Auto-compute prestige tier from repo signals.
 *
 *   entry    — small / accessible projects    (<1K stars)
 *   mid      — established projects           (1K–15K stars)
 *   high     — popular projects               (15K–60K stars)
 *   prestige — elite / flagship projects      (60K+ stars)
 */
export type PrestigeTierName = "entry" | "mid" | "high" | "prestige";

export function computePrestigeTier(
  starCount: number,
  _openIssueCount: number,
  _hasGoodFirstIssues: boolean,
): PrestigeTierName {
  if (starCount >= 60_000) return "prestige";
  if (starCount >= 15_000) return "high";
  if (starCount >= 1_000) return "mid";
  return "entry";
}

/**
 * Compute per-issue minimum tier based on the repo's prestige tier
 * PLUS the individual issue's complexity signals (labels, body length).
 *
 * Within a "high" prestige repo, a "good first issue" should still be
 * Tier 1/2 accessible, while an issue labeled "complex" or "architecture"
 * should require Tier 3/4.
 */
const EASY_LABELS = [
  "good first issue",
  "beginner",
  "easy",
  "starter",
  "help wanted",
  "documentation",
  "docs",
  "typo",
  "low-hanging fruit",
];

const HARD_LABELS = [
  "complex",
  "architecture",
  "breaking change",
  "security",
  "performance",
  "critical",
  "refactor",
  "internals",
  "advanced",
];

export function computeIssueTier(
  repoPrestigeTier: PrestigeTierName,
  labels: string[],
  bodyLength: number,
): number {
  const lowerLabels = labels.map((l) => l.toLowerCase());

  const hasEasyLabel = lowerLabels.some((l) =>
    EASY_LABELS.some((e) => l.includes(e))
  );
  const hasHardLabel = lowerLabels.some((l) =>
    HARD_LABELS.some((h) => l.includes(h))
  );

  if (hasEasyLabel && !hasHardLabel) return 1;
  if (hasHardLabel && !hasEasyLabel) {
    const hardBase: Record<PrestigeTierName, number> = { entry: 2, mid: 3, high: 3, prestige: 4 };
    return hardBase[repoPrestigeTier];
  }

  const PRESTIGE_BASE: Record<PrestigeTierName, number> = {
    entry: 1,
    mid: 1,
    high: 2,
    prestige: 3,
  };

  let tier = PRESTIGE_BASE[repoPrestigeTier];

  if (bodyLength > 2000) tier = Math.min(4, tier + 1);

  return Math.max(1, Math.min(4, tier));
}

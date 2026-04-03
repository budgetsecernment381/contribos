import type { UserGoal, TimeBudget } from "@prisma/client";

export interface GitHubSignals {
  accountAgeMonths: number;
  publicRepoCount: number;
  contributionCountLastYear: number;
  languagesWithContributions: number;
  maxStarsOnContributedRepo: number;
}

export interface CalibrationAnswers {
  familiarityLevel: "never" | "occasional" | "regular" | "contributed";
  fixIntent: "minimal_safe" | "correct_complete" | "full_understanding";
  openEndedResponse?: string;
}

export interface TierResult {
  tier: number;
  rationale: string;
}

/**
 * Compute tier (1-3 max at onboarding) from GitHub signals and calibration.
 * Tier 4 is only achievable through platform performance.
 */
export function computeTier(
  signals: GitHubSignals,
  calibration: CalibrationAnswers,
  goal?: UserGoal | null,
  timeBudget?: TimeBudget | null
): TierResult {
  let rawScore = 0;

  if (signals.accountAgeMonths >= 24) rawScore += 25;
  else if (signals.accountAgeMonths >= 12) rawScore += 18;
  else if (signals.accountAgeMonths >= 6) rawScore += 10;

  if (signals.publicRepoCount >= 10) rawScore += 20;
  else if (signals.publicRepoCount >= 5) rawScore += 15;
  else if (signals.publicRepoCount >= 2) rawScore += 8;

  if (signals.contributionCountLastYear >= 50) rawScore += 25;
  else if (signals.contributionCountLastYear >= 20) rawScore += 18;
  else if (signals.contributionCountLastYear >= 5) rawScore += 10;

  if (signals.languagesWithContributions >= 3) rawScore += 15;
  else if (signals.languagesWithContributions >= 2) rawScore += 10;

  if (signals.maxStarsOnContributedRepo >= 10000) rawScore += 15;
  else if (signals.maxStarsOnContributedRepo >= 1000) rawScore += 10;

  const calMap = {
    never: 0,
    occasional: 5,
    regular: 10,
    contributed: 15,
  };
  rawScore += calMap[calibration.familiarityLevel] ?? 0;

  const intentMap = {
    minimal_safe: 0,
    correct_complete: 5,
    full_understanding: 10,
  };
  rawScore += intentMap[calibration.fixIntent] ?? 0;

  if (goal === "ecosystem_depth" || goal === "give_back") rawScore += 5;
  if (timeBudget === "deep") rawScore += 5;

  let tier = 1;
  if (rawScore >= 70) tier = 3;
  else if (rawScore >= 45) tier = 2;

  const rationale = `Account age: ${signals.accountAgeMonths}mo, repos: ${signals.publicRepoCount}, contributions: ${signals.contributionCountLastYear}, languages: ${signals.languagesWithContributions}. Calibration: ${calibration.familiarityLevel}/${calibration.fixIntent}. Raw score: ${rawScore} -> Tier ${tier}.`;

  return { tier, rationale };
}

const TIER_DIFF_LIMITS: Record<number, number> = {
  1: 200,
  2: 400,
  3: 800,
  4: Infinity,
};

export interface GateInput {
  confidenceScore: number | null;
  diffLinesChanged: number | null;
  tier: number;
  repoArchived: boolean;
  lastMaintainerActivityAt: Date | null;
  riskFlags: unknown;
}

export interface GateResult {
  passed: boolean;
  reason?: string;
}

/**
 * Quality gate evaluation:
 * - confidence >= 55
 * - diff size limits per tier (T1: 200, T2: 400, T3: 800, T4: unlimited)
 * - repo freshness (not archived, maintainer activity within 90 days)
 * - secret detection (any secret-like token blocks)
 * - test pass (all generated tests must pass - checked via riskFlags)
 */
export function evaluateGate(input: GateInput): GateResult {
  if ((input.confidenceScore ?? 0) < 55) {
    return { passed: false, reason: "Confidence score below 55" };
  }

  const limit = TIER_DIFF_LIMITS[input.tier] ?? 200;
  if (
    input.diffLinesChanged != null &&
    input.diffLinesChanged > limit
  ) {
    return {
      passed: false,
      reason: `Diff size ${input.diffLinesChanged} exceeds tier limit ${limit}`,
    };
  }

  if (input.repoArchived) {
    return { passed: false, reason: "Repository is archived" };
  }

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  if (
    input.lastMaintainerActivityAt &&
    input.lastMaintainerActivityAt < ninetyDaysAgo
  ) {
    return {
      passed: false,
      reason: "No maintainer activity within 90 days",
    };
  }

  const flags = input.riskFlags as Record<string, unknown> | null;
  if (flags?.secretsDetected === true) {
    return { passed: false, reason: "Secrets detected in diff" };
  }
  if (flags?.testsFailed === true) {
    return { passed: false, reason: "Generated tests failed" };
  }

  return { passed: true };
}

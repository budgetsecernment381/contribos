/**
 * Prestige graph job — recalculates repository prestige scores
 * based on star count, maintainer activity, and contribution patterns.
 */

import { prisma } from "../../lib/prisma.js";
import type { PrestigeTier } from "@prisma/client";

interface PrestigeInput {
  starCount: number;
  maintainerActivityScore: number;
  contributionCount: number;
  avgSentiment: number;
}

/** Compute prestige score 0-100 from repository signals. */
function computePrestigeScore(input: PrestigeInput): number {
  let score = 0;

  if (input.starCount >= 50000) score += 40;
  else if (input.starCount >= 10000) score += 35;
  else if (input.starCount >= 1000) score += 25;
  else if (input.starCount >= 100) score += 15;
  else score += 5;

  score += Math.min(30, input.maintainerActivityScore * 30);

  if (input.contributionCount >= 20) score += 20;
  else if (input.contributionCount >= 10) score += 15;
  else if (input.contributionCount >= 5) score += 10;

  score += Math.min(10, input.avgSentiment * 10);

  return Math.max(0, Math.min(100, score));
}

/** Map numeric prestige score to tier enum. */
function scoreToTier(score: number): PrestigeTier {
  if (score >= 80) return "prestige";
  if (score >= 60) return "high";
  if (score >= 35) return "mid";
  return "entry";
}

/** Run full prestige graph recalculation for all approved repositories. */
export async function runPrestigeGraphJob(): Promise<{
  processed: number;
  updated: number;
}> {
  const repos = await prisma.repository.findMany({
    where: { allowlistState: "approved", isArchived: false },
    include: {
      pullRequests: {
        select: { maintainerSentimentScore: true },
      },
      issues: {
        select: { id: true },
        where: { claimStatus: "claimed" },
      },
    },
  });

  const updates: Array<{ id: string; prestigeScore: number; prestigeTier: PrestigeTier }> = [];

  for (const repo of repos) {
    const sentimentScores = repo.pullRequests
      .map((p) => p.maintainerSentimentScore)
      .filter((s): s is number => s !== null);
    const avgSentiment =
      sentimentScores.length > 0
        ? sentimentScores.reduce((a, b) => a + b, 0) / sentimentScores.length
        : 0.5;

    const score = computePrestigeScore({
      starCount: repo.starCount,
      maintainerActivityScore: repo.maintainerActivityScore,
      contributionCount: repo.issues.length,
      avgSentiment,
    });

    const tier = scoreToTier(score);

    if (repo.prestigeScore !== score || repo.prestigeTier !== tier) {
      updates.push({ id: repo.id, prestigeScore: score, prestigeTier: tier });
    }
  }

  if (updates.length > 0) {
    await prisma.$transaction(
      updates.map((u) =>
        prisma.repository.update({
          where: { id: u.id },
          data: { prestigeScore: u.prestigeScore, prestigeTier: u.prestigeTier },
        })
      )
    );
  }

  return { processed: repos.length, updated: updates.length };
}

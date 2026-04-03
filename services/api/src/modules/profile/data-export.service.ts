/**
 * Data export service — generates GDPR-compliant data exports for users.
 */

import { prisma } from "../../lib/prisma.js";
import type { Result } from "../../common/types/result.js";
import { ok, err } from "../../common/types/result.js";
import { notFound } from "../../common/errors/app-error.js";

export interface DataExport {
  user: {
    githubUsername: string;
    email: string | null;
    tier: number;
    contributionHealthScore: number;
    planTier: string;
    creditBalance: number;
    createdAt: Date;
  };
  profile: {
    bio: string | null;
    goal: string | null;
    timeBudget: string | null;
    visibility: string;
    preferredLlmProvider: string | null;
    preferredLlmModel: string | null;
  } | null;
  ecosystems: Array<{ name: string; contributionCount: number }>;
  jobs: Array<{
    id: string;
    status: string;
    llmProvider: string;
    llmModel: string;
    createdAt: Date;
  }>;
  reviews: Array<{
    id: string;
    comprehensionScore: number | null;
    screen1State: string;
    createdAt: Date;
  }>;
  pullRequests: Array<{
    id: string;
    state: string;
    repoFullName: string;
    createdAt: Date;
  }>;
  inboxItems: Array<{
    id: string;
    commentType: string;
    isAcknowledged: boolean;
    createdAt: Date;
  }>;
  contributionEvents: Array<{
    eventType: string;
    chsDelta: number;
    occurredAt: Date;
  }>;
  creditTransactions: Array<{
    transactionType: string;
    amount: number;
    balanceAfter: number;
    createdAt: Date;
  }>;
  exportedAt: Date;
}

/** Generate a full data export for GDPR compliance. */
export async function generateDataExport(
  userId: string
): Promise<Result<DataExport>> {
  const EXPORT_LIMIT = 5000;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: true,
      ecosystems: true,
      jobs: { orderBy: { createdAt: "desc" }, take: EXPORT_LIMIT },
      reviews: { orderBy: { createdAt: "desc" }, take: EXPORT_LIMIT },
      pullRequests: { orderBy: { createdAt: "desc" }, take: EXPORT_LIMIT },
      inboxItems: { orderBy: { createdAt: "desc" }, take: EXPORT_LIMIT },
      contributionEvents: { orderBy: { occurredAt: "desc" }, take: EXPORT_LIMIT },
      creditTransactions: { orderBy: { createdAt: "desc" }, take: EXPORT_LIMIT },
    },
  });

  if (!user) return err(notFound("User not found"));

  return ok({
    user: {
      githubUsername: user.githubUsername,
      email: user.email,
      tier: user.tier,
      contributionHealthScore: user.contributionHealthScore,
      planTier: user.planTier,
      creditBalance: user.creditBalance,
      createdAt: user.createdAt,
    },
    profile: user.profile
      ? {
          bio: user.profile.bio,
          goal: user.profile.goal,
          timeBudget: user.profile.timeBudget,
          visibility: user.profile.visibility,
          preferredLlmProvider: user.profile.preferredLlmProvider,
          preferredLlmModel: user.profile.preferredLlmModel,
        }
      : null,
    ecosystems: user.ecosystems.map((e) => ({
      name: e.ecosystemName,
      contributionCount: e.contributionCount,
    })),
    jobs: user.jobs.map((j) => ({
      id: j.id,
      status: j.status,
      llmProvider: j.llmProvider,
      llmModel: j.llmModel,
      createdAt: j.createdAt,
    })),
    reviews: user.reviews.map((r) => ({
      id: r.id,
      comprehensionScore: r.comprehensionScore,
      screen1State: r.screen1State,
      createdAt: r.createdAt,
    })),
    pullRequests: user.pullRequests.map((p) => ({
      id: p.id,
      state: p.state,
      repoFullName: p.githubRepoFullName,
      createdAt: p.createdAt,
    })),
    inboxItems: user.inboxItems.map((i) => ({
      id: i.id,
      commentType: i.commentType,
      isAcknowledged: i.isAcknowledged,
      createdAt: i.createdAt,
    })),
    contributionEvents: user.contributionEvents.map((e) => ({
      eventType: e.eventType,
      chsDelta: e.chsDelta,
      occurredAt: e.occurredAt,
    })),
    creditTransactions: user.creditTransactions.map((t) => ({
      transactionType: t.transactionType,
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      createdAt: t.createdAt,
    })),
    exportedAt: new Date(),
  });
}

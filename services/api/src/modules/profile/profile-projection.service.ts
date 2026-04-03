/**
 * Profile projection service — builds read-optimized profile views
 * for the public profile card and contributor dashboard.
 */

import { prisma } from "../../lib/prisma.js";
import type { Result } from "../../common/types/result.js";
import { ok, err } from "../../common/types/result.js";
import { notFound, forbidden } from "../../common/errors/app-error.js";

export interface ProfileProjection {
  username: string;
  avatarUrl: string | null;
  headline: string | null;
  tier: number;
  contributionHealthScore: number;
  trustBadgeLevel: number;
  ecosystems: EcosystemProjection[];
  recentContributions: ContributionProjection[];
  stats: ProfileStats;
}

export interface EcosystemProjection {
  name: string;
  contributionCount: number;
  averageChs: number;
  highestRepoTier: number;
}

export interface ContributionProjection {
  repoFullName: string;
  prState: string;
  mergedAt: Date | null;
  ecosystem: string;
}

export interface ProfileStats {
  totalPrs: number;
  mergedPrs: number;
  mergeRate: number;
  averageComprehension: number;
  memberSince: Date;
}

/** Build full profile projection for public display. */
export async function buildProfileProjection(
  slug: string,
  requestUserId?: string
): Promise<Result<ProfileProjection>> {
  const profile = await prisma.userProfile.findUnique({
    where: { shareableSlug: slug },
    include: {
      user: {
        include: {
          ecosystems: true,
          pullRequests: {
            include: { repository: true },
            orderBy: { createdAt: "desc" },
            take: 10,
          },
          reviews: {
            select: { comprehensionScore: true },
          },
        },
      },
    },
  });

  if (!profile) return err(notFound("Profile not found"));

  if (profile.visibility === "private" && profile.userId !== requestUserId) {
    return err(forbidden("Profile is private"));
  }

  const user = profile.user;

  const [totalPrs, mergedPrs] = await Promise.all([
    prisma.pullRequest.count({ where: { userId: user.id } }),
    prisma.pullRequest.count({ where: { userId: user.id, state: "merged" } }),
  ]);

  const comprehensionScores = user.reviews
    .map((r) => r.comprehensionScore)
    .filter((s): s is number => s !== null);

  return ok({
    username: user.githubUsername,
    avatarUrl: user.avatarUrl,
    headline: profile.headline,
    tier: user.tier,
    contributionHealthScore: user.contributionHealthScore,
    trustBadgeLevel: profile.trustBadgeLevel,
    ecosystems: user.ecosystems.map((e) => ({
      name: e.ecosystemName,
      contributionCount: e.contributionCount,
      averageChs: e.averageChs,
      highestRepoTier: e.highestRepoTierReached,
    })),
    recentContributions: user.pullRequests.slice(0, 5).map((pr) => ({
      repoFullName: pr.repository.fullName,
      prState: pr.state,
      mergedAt: pr.mergedAt,
      ecosystem: pr.repository.ecosystem,
    })),
    stats: {
      totalPrs,
      mergedPrs,
      mergeRate: totalPrs > 0 ? Math.round((mergedPrs / totalPrs) * 100) : 0,
      averageComprehension:
        comprehensionScores.length > 0
          ? Math.round(
              comprehensionScores.reduce((a, b) => a + b, 0) /
                comprehensionScores.length
            )
          : 0,
      memberSince: user.createdAt,
    },
  });
}

/** Build dashboard projection for authenticated user. */
export async function buildDashboardProjection(
  userId: string
): Promise<
  Result<{
    tier: number;
    chs: number;
    creditBalance: number;
    activeJobs: number;
    pendingReviews: number;
    unreadInbox: number;
    recentActivity: Array<{
      type: string;
      description: string;
      createdAt: Date;
    }>;
  }>
> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return err(notFound("User not found"));

  const [activeJobs, pendingReviews, unreadInbox] = await Promise.all([
    prisma.job.count({
      where: { userId, status: { in: ["queued", "running"] } },
    }),
    prisma.review.count({
      where: { userId, screen1State: { not: "completed" } },
    }),
    prisma.pRInboxItem.count({
      where: { userId, isAcknowledged: false },
    }),
  ]);

  const recentEvents = await prisma.contributionEvent.findMany({
    where: { userId },
    orderBy: { occurredAt: "desc" },
    take: 5,
    include: { pullRequest: { select: { githubRepoFullName: true } } },
  });

  return ok({
    tier: user.tier,
    chs: user.contributionHealthScore,
    creditBalance: user.creditBalance,
    activeJobs,
    pendingReviews,
    unreadInbox,
    recentActivity: recentEvents.map((e) => ({
      type: e.eventType,
      description: `${e.eventType} on ${e.pullRequest.githubRepoFullName}`,
      createdAt: e.occurredAt,
    })),
  });
}

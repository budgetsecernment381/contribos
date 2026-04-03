/**
 * Claim service — manages issue claim lifecycle with concurrency safety.
 */

import { prisma } from "../../lib/prisma.js";
import type { Result } from "../../common/types/result.js";
import { ok, err } from "../../common/types/result.js";
import {
  notFound,
  forbidden,
  claimConflict,
  validationError,
} from "../../common/errors/app-error.js";

const MAX_CONCURRENT_CLAIMS = 3;
const CLAIM_EXPIRY_HOURS = 72;

/** Check if user has exceeded concurrent claim limit. */
export async function checkClaimLimit(userId: string): Promise<boolean> {
  const activeClaims = await prisma.issue.count({
    where: {
      claimedByUserId: userId,
      claimStatus: "claimed",
    },
  });
  return activeClaims < MAX_CONCURRENT_CLAIMS;
}

/** Claim an issue with optimistic locking. */
export async function claimIssue(
  userId: string,
  issueId: string
): Promise<Result<{ claimedAt: Date }>> {
  const withinLimit = await checkClaimLimit(userId);
  if (!withinLimit) {
    return err(
      validationError(`Maximum ${MAX_CONCURRENT_CLAIMS} concurrent claims allowed`)
    );
  }

  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    include: { repository: true },
  });
  if (!issue) return err(notFound("Issue not found"));

  if (issue.claimStatus !== "available") {
    return err(claimConflict());
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return err(notFound("User not found"));
  if (user.tier < issue.minimumTier) {
    return err(validationError("User tier too low for this issue"));
  }

  if (!user.onboardingComplete) {
    return err(validationError("Complete onboarding before claiming issues"));
  }

  const claimedAt = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      const locked = await tx.issue.findUnique({ where: { id: issueId } });
      if (!locked || locked.claimStatus !== "available") {
        throw new Error("CLAIM_CONFLICT");
      }
      await tx.issue.update({
        where: { id: issueId },
        data: {
          claimStatus: "claimed",
          claimedByUserId: userId,
          claimedAt,
        },
      });
    });
    return ok({ claimedAt });
  } catch (e) {
    if (e instanceof Error && e.message === "CLAIM_CONFLICT") {
      return err(claimConflict());
    }
    throw e;
  }
}

/** Release a claim on an issue (owner only), using a transaction to prevent TOCTOU. */
export async function releaseClaim(
  userId: string,
  issueId: string
): Promise<Result<void>> {
  try {
    await prisma.$transaction(async (tx) => {
      const issue = await tx.issue.findUnique({ where: { id: issueId } });
      if (!issue) throw new Error("NOT_FOUND");
      if (issue.claimedByUserId !== userId) throw new Error("FORBIDDEN");

      await tx.issue.update({
        where: { id: issueId },
        data: {
          claimStatus: "available",
          claimedByUserId: null,
          claimedAt: null,
        },
      });
    });
    return ok(undefined);
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "NOT_FOUND") return err(notFound("Issue not found"));
      if (e.message === "FORBIDDEN") return err(forbidden("You do not own this claim"));
    }
    throw e;
  }
}

/** Expire stale claims beyond the configured threshold. */
export async function expireStaleClaims(): Promise<number> {
  const threshold = new Date();
  threshold.setHours(threshold.getHours() - CLAIM_EXPIRY_HOURS);

  const result = await prisma.issue.updateMany({
    where: {
      claimStatus: "claimed",
      claimedAt: { lt: threshold },
      jobs: { none: {} },
    },
    data: {
      claimStatus: "available",
      claimedByUserId: null,
      claimedAt: null,
    },
  });

  return result.count;
}

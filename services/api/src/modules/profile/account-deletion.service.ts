/**
 * Account deletion service — handles user data deletion for GDPR compliance.
 * Cascade deletes are configured in the Prisma schema for direct relations.
 * This service handles cleanup of non-cascading data.
 */

import { prisma } from "../../lib/prisma.js";
import type { Result } from "../../common/types/result.js";
import { ok, err } from "../../common/types/result.js";
import { notFound, validationError } from "../../common/errors/app-error.js";

/** Delete a user account and all associated data. */
export async function deleteAccount(
  userId: string
): Promise<Result<{ deletedAt: Date }>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      jobs: { where: { status: { in: ["queued", "running"] } } },
    },
  });

  if (!user) return err(notFound("User not found"));

  if (user.jobs.length > 0) {
    return err(
      validationError(
        "Cannot delete account with active jobs. Wait for jobs to complete or cancel them."
      )
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.contributionEvent.deleteMany({ where: { userId } });
    await tx.creditTransaction.deleteMany({ where: { userId } });
    await tx.pRInboxItem.deleteMany({ where: { userId } });
    await tx.pullRequest.deleteMany({ where: { userId } });
    await tx.review.deleteMany({ where: { userId } });
    await tx.job.deleteMany({ where: { userId } });

    await tx.issue.updateMany({
      where: { claimedByUserId: userId },
      data: {
        claimStatus: "available",
        claimedByUserId: null,
        claimedAt: null,
      },
    });

    await tx.userEcosystem.deleteMany({ where: { userId } });
    await tx.userProfile.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
  });

  return ok({ deletedAt: new Date() });
}

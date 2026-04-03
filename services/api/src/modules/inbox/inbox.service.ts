import { prisma } from "../../lib/prisma.js";
import type { Result } from "../../common/types/result.js";
import { ok, err } from "../../common/types/result.js";
import { notFound, forbidden } from "../../common/errors/app-error.js";
import type { CommentType } from "@prisma/client";
import {
  generateGuidance,
  generateHoldingReply,
} from "./guidance.service.js";

export interface InboxItem {
  id: string;
  pullRequestId: string;
  githubCommentId: number;
  commentType: CommentType;
  paraphrase: string;
  suggestedApproach: string;
  codeNavHint: string | null;
  toneGuidance: string | null;
  holdingReplyTemplate: string | null;
  isAcknowledged: boolean;
  acknowledgedAt: Date | null;
  createdAt: Date;
}

export interface InboxFilters {
  prId?: string;
  commentType?: CommentType;
  acknowledged?: boolean;
}

/**
 * List inbox items with filters.
 */
export async function listInboxItems(
  userId: string,
  filters: InboxFilters = {},
  limit = 50
): Promise<Result<InboxItem[]>> {
  const items = await prisma.pRInboxItem.findMany({
    where: {
      userId,
      ...(filters.prId && { pullRequestId: filters.prId }),
      ...(filters.commentType && { commentType: filters.commentType }),
      ...(filters.acknowledged !== undefined && {
        isAcknowledged: filters.acknowledged,
      }),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return ok(
    items.map((i) => ({
      id: i.id,
      pullRequestId: i.pullRequestId,
      githubCommentId: i.githubCommentId,
      commentType: i.commentType,
      paraphrase: i.paraphrase,
      suggestedApproach: i.suggestedApproach,
      codeNavHint: i.codeNavHint,
      toneGuidance: i.toneGuidance,
      holdingReplyTemplate: i.holdingReplyTemplate,
      isAcknowledged: i.isAcknowledged,
      acknowledgedAt: i.acknowledgedAt,
      createdAt: i.createdAt,
    }))
  );
}

/**
 * Get inbox item detail.
 */
export async function getInboxItem(
  userId: string,
  itemId: string
): Promise<Result<InboxItem>> {
  const item = await prisma.pRInboxItem.findUnique({
    where: { id: itemId },
  });
  if (!item) return err(notFound("Inbox item not found"));
  if (item.userId !== userId) return err(forbidden("Not your inbox item"));

  return ok({
    id: item.id,
    pullRequestId: item.pullRequestId,
    githubCommentId: item.githubCommentId,
    commentType: item.commentType,
    paraphrase: item.paraphrase,
    suggestedApproach: item.suggestedApproach,
    codeNavHint: item.codeNavHint,
    toneGuidance: item.toneGuidance,
    holdingReplyTemplate: item.holdingReplyTemplate,
    isAcknowledged: item.isAcknowledged,
    acknowledgedAt: item.acknowledgedAt,
    createdAt: item.createdAt,
  });
}

/**
 * Mark inbox item as acknowledged.
 */
export async function acknowledgeItem(
  userId: string,
  itemId: string
): Promise<Result<void>> {
  const item = await prisma.pRInboxItem.findUnique({
    where: { id: itemId },
  });
  if (!item) return err(notFound("Inbox item not found"));
  if (item.userId !== userId) return err(forbidden("Not your inbox item"));

  await prisma.pRInboxItem.update({
    where: { id: itemId },
    data: { isAcknowledged: true, acknowledgedAt: new Date() },
  });

  return ok(undefined);
}

/**
 * Process GitHub webhook - create inbox item with dedupe.
 * Five-element guidance: paraphrase, type, approach, code hint, tone.
 */
export async function processCommentWebhook(
  prId: string,
  userId: string,
  githubCommentId: number,
  body: string
): Promise<void> {
  const dedupeKey = `${prId}-${githubCommentId}`;

  const existing = await prisma.pRInboxItem.findUnique({
    where: { dedupeKey },
  });
  if (existing) return;

  const pr = await prisma.pullRequest.findUnique({
    where: { id: prId },
    include: { repository: true },
  });

  const guidance = await generateGuidance(
    body,
    pr?.githubRepoFullName ?? "",
    pr?.repository?.fullName ?? "",
    userId
  );

  const holdingReply = generateHoldingReply(guidance.commentType);

  try {
    await prisma.pRInboxItem.create({
      data: {
        pullRequestId: prId,
        userId,
        githubCommentId,
        commentType: guidance.commentType as CommentType,
        paraphrase: guidance.paraphrase,
        suggestedApproach: guidance.suggestedApproach,
        codeNavHint: guidance.codeNavHint,
        toneGuidance: guidance.toneGuidance,
        holdingReplyTemplate: holdingReply,
        dedupeKey,
      },
    });
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as { code: string }).code === "P2002") {
      return;
    }
    throw e;
  }
}

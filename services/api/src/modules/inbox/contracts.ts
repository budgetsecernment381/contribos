/**
 * Inbox module contracts — shared types for webhook processing and guidance.
 */

import { z } from "zod";

export const acknowledgeSchema = z.object({
  itemId: z.string().cuid(),
});

export const inboxFilterSchema = z.object({
  prId: z.string().cuid().optional(),
  commentType: z
    .enum(["question", "change_request", "approval", "clarification", "merge_feedback"])
    .optional(),
  acknowledged: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type AcknowledgeDTO = z.infer<typeof acknowledgeSchema>;
export type InboxFilterDTO = z.infer<typeof inboxFilterSchema>;

export interface GuidanceElement {
  paraphrase: string;
  commentType: string;
  suggestedApproach: string;
  codeNavHint: string | null;
  toneGuidance: string | null;
}

export interface InboxItemDTO {
  id: string;
  pullRequestId: string;
  githubCommentId: number;
  commentType: string;
  paraphrase: string;
  suggestedApproach: string;
  codeNavHint: string | null;
  toneGuidance: string | null;
  holdingReplyTemplate: string | null;
  isAcknowledged: boolean;
  acknowledgedAt: Date | null;
  createdAt: Date;
}

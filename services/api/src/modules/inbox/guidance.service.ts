/**
 * Guidance service — generates 5-element guidance for inbox items using LLM gateway.
 * Elements: paraphrase, type classification, suggested approach, code nav hint, tone guidance.
 */

import { complete as llmComplete } from "../ai/llm.gateway.js";
import type { GuidanceElement } from "./contracts.js";
import { z } from "zod";

const guidanceSchema = z.object({
  paraphrase: z.string().min(1),
  commentType: z.enum(["question", "change_request", "approval", "clarification", "merge_feedback"]),
  suggestedApproach: z.string().min(1),
  codeNavHint: z.string().nullable().default(null),
  toneGuidance: z.string().nullable().default(null),
});

/** Generate 5-element guidance for a maintainer comment using LLM. */
export async function generateGuidance(
  commentBody: string,
  prTitle: string,
  repoFullName: string,
  userId?: string
): Promise<GuidanceElement> {
  try {
    const response = await llmComplete({
      workflow: "inbox_guidance",
      userId,
      messages: [
        {
          role: "system",
          content: `You are a mentor helping open-source contributors respond to maintainer feedback.
Given a maintainer comment on a PR, generate 5-element guidance as JSON:
{
  "paraphrase": "simplified restatement of the comment",
  "commentType": "question|change_request|approval|clarification|merge_feedback",
  "suggestedApproach": "actionable response strategy",
  "codeNavHint": "relevant files/lines to look at, or null",
  "toneGuidance": "recommended communication style"
}
Output ONLY the JSON object, no markdown.`,
        },
        {
          role: "user",
          content: `PR: "${prTitle}" in ${repoFullName}\n\nMaintainer comment:\n${commentBody}`,
        },
      ],
      maxTokens: 512,
      temperature: 0.3,
    });

    const raw = JSON.parse(response.text);
    const validated = guidanceSchema.safeParse(raw);
    if (validated.success) {
      return validated.data;
    }
  } catch {
    // Fallback to rule-based guidance
  }

  return fallbackGuidance(commentBody);
}

/** Rule-based fallback when LLM is unavailable. */
function fallbackGuidance(commentBody: string): GuidanceElement {
  const lower = commentBody.toLowerCase();

  let commentType = "clarification";
  if (lower.includes("?")) commentType = "question";
  else if (lower.includes("change") || lower.includes("please"))
    commentType = "change_request";
  else if (lower.includes("lgtm") || lower.includes("approve"))
    commentType = "approval";
  else if (lower.includes("merge")) commentType = "merge_feedback";

  return {
    paraphrase: commentBody.slice(0, 200),
    commentType,
    suggestedApproach: "Review the comment and address feedback",
    codeNavHint: null,
    toneGuidance: "Professional and respectful",
  };
}

/** Generate a holding reply template for the contributor. */
export function generateHoldingReply(commentType: string): string {
  const templates: Record<string, string> = {
    question:
      "Thanks for the question! I'm looking into this and will follow up with an answer shortly.",
    change_request:
      "Thank you for the feedback! I'm working on the requested changes and will push an update soon.",
    approval: "Thank you for the review and approval!",
    clarification:
      "Thanks for the clarification! I'll incorporate this feedback and update the PR.",
    merge_feedback:
      "Thank you for the merge feedback! I'll address any remaining items.",
  };

  return templates[commentType] ?? templates.clarification;
}

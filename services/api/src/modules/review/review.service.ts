import { prisma } from "../../lib/prisma.js";
import type { Result } from "../../common/types/result.js";
import { ok, err } from "../../common/types/result.js";
import {
  notFound,
  forbidden,
  reviewNotEligible,
  validationError,
} from "../../common/errors/app-error.js";
import type { Screen1State } from "@prisma/client";
import { complete } from "../ai/llm.gateway.js";

const PASSING_SCORE = 70;
const MAX_RETRIES = 1;

export interface Screen1Content {
  sectionA: string | null;
  sectionB: string | null;
  diffKey: string | null;
  questions: unknown[];
  state: Screen1State;
  unlockedSections: string[];
}

export interface ComprehensionPayload {
  answers: Record<string, unknown>;
  oneLiner: string;
}


/** Returns review state and metadata. */
export async function getReview(
  userId: string,
  reviewId: string
): Promise<
  Result<{
    id: string;
    jobId: string;
    screen1State: Screen1State;
    comprehensionScore: number | null;
    oneLiner: string | null;
    retryCount: number;
    approvalTimestamp: Date | null;
    screen2PrType: string;
    screen2CommitStyle: string;
  }>
> {
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) return err(notFound("Review not found"));
  if (review.userId !== userId) return err(forbidden("Not your review"));

  return ok({
    id: review.id,
    jobId: review.jobId,
    screen1State: review.screen1State,
    comprehensionScore: review.comprehensionScore,
    oneLiner: review.oneLiner,
    retryCount: review.retryCount,
    approvalTimestamp: review.approvalTimestamp,
    screen2PrType: review.screen2PrType,
    screen2CommitStyle: review.screen2CommitStyle,
  });
}

/** Returns Screen 1 content — all sections available immediately.
 *  Advances state to questions_presented so comprehension submission is allowed. */
export async function getScreen1Content(
  userId: string,
  reviewId: string,
  _requestedSection?: "summary" | "rationale" | "diff" | "comprehension"
): Promise<Result<Screen1Content>> {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    include: { job: { include: { issue: true } } },
  });
  if (!review) return err(notFound("Review not found"));
  if (review.userId !== userId) return err(forbidden("Not your review"));

  const job = review.job;
  if (job.status !== "review_pending") {
    return err(reviewNotEligible("Job not in review_pending state"));
  }

  const artifacts = job.artifactKeys as Record<string, string> | null;
  let questionsPayload = review.questionsPayload as { questions?: unknown[] } | null;

  const diff = artifacts?.diff_key ?? "";
  const summary = artifacts?.summary_key ?? "";
  const issueTitle = job.issue?.title ?? "Unknown issue";

  const isFallbackQuestions = (qs: unknown[]): boolean => {
    if (!qs || qs.length === 0) return true;
    const first = qs[0] as { question?: string };
    return !!first?.question?.startsWith("What type of change does this fix for");
  };

  const needsGeneration = !questionsPayload?.questions ||
    questionsPayload.questions.length === 0 ||
    isFallbackQuestions(questionsPayload.questions);

  if (needsGeneration && diff.trim()) {
    try {
      const questions = await generateQuestionsFromDiff(diff, summary, issueTitle, userId);
      questionsPayload = { questions };
      await prisma.review.update({
        where: { id: reviewId },
        data: { questionsPayload: questionsPayload as object },
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      process.stderr.write(
        JSON.stringify({ level: "warn", msg: "Question generation failed, using fallback", reviewId, error: errMsg }) + "\n"
      );
      questionsPayload = { questions: generateFallbackQuestions(issueTitle, summary) };
    }
  } else if (!questionsPayload?.questions || questionsPayload.questions.length === 0) {
    questionsPayload = { questions: generateFallbackQuestions(issueTitle, summary) };
  }

  if (
    review.screen1State !== "questions_presented" &&
    review.screen1State !== "completed"
  ) {
    await prisma.review.update({
      where: { id: reviewId },
      data: { screen1State: "questions_presented" },
    });
  }

  return ok({
    sectionA: artifacts?.summary_key ?? null,
    sectionB: artifacts?.trace_key ?? null,
    diffKey: artifacts?.diff_key ?? null,
    questions: questionsPayload?.questions ?? [],
    state: "questions_presented",
    unlockedSections: ["summary", "rationale", "diff", "comprehension"],
  });
}

/** Generates context-aware comprehension questions from the diff and summary using LLM. */
export async function generateQuestionsFromDiff(
  diff: string,
  summary: string,
  issueTitle: string,
  userId?: string
): Promise<unknown[]> {
  const truncatedDiff = diff.slice(0, 4000);

  try {
    const response = await complete({
      workflow: "comprehension",
      userId,
      messages: [
        {
          role: "system",
          content: `You generate comprehension questions to verify a contributor understands a code fix. Output ONLY valid JSON — an array of question objects. No markdown, no explanation.

Each question object must have:
- "id": unique string like "q1", "q2", "q3"
- "type": one of "mcq", "yesno", or "freetext"
- "question": the question text

For "mcq" type, also include:
- "options": array of {"key": "a"|"b"|"c"|"d", "text": "option text"}
- "correctKey": the correct option key

For "yesno" type, also include:
- "correctAnswer": true or false

Generate exactly 3 questions:
1. An MCQ about what specifically this diff changes (with options derived from the actual code)
2. A yes/no question about a specific technical detail in the diff
3. A freetext question asking the contributor to explain why this fix addresses the issue

Make questions SPECIFIC to the actual code changes — reference file names, function names, import changes, or patterns visible in the diff.`,
        },
        {
          role: "user",
          content: `Issue: ${issueTitle}
Summary: ${summary}

Diff:
${truncatedDiff}

Generate 3 comprehension questions about this specific diff.`,
        },
      ],
      maxTokens: 1024,
      temperature: 0.3,
    });

    let text = response.text.trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) text = jsonMatch[0];

    const questions = JSON.parse(text);
    if (Array.isArray(questions) && questions.length > 0) {
      return questions;
    }
  } catch {
    // Fall through to default questions derived from issue context
  }

  return generateFallbackQuestions(issueTitle, summary);
}

function generateFallbackQuestions(issueTitle: string, _summary?: string): unknown[] {
  return [
    {
      id: "q1",
      type: "mcq",
      question: `What type of change does this fix for "${issueTitle}" primarily involve?`,
      options: [
        { key: "a", text: "Adding new functionality" },
        { key: "b", text: "Fixing imports, types, or module resolution" },
        { key: "c", text: "Refactoring business logic" },
        { key: "d", text: "Updating configuration or documentation" },
      ],
      correctKey: "b",
    },
    {
      id: "q2",
      type: "freetext",
      question: `Based on the diff, what specific files or patterns were changed and why does this fix address the issue "${issueTitle}"?`,
    },
    {
      id: "q3",
      type: "freetext",
      question: "Are there any potential risks or side effects from this change? If so, what are they?",
    },
  ];
}

/** Scores comprehension answers against the question set. */
function scoreAnswers(
  questions: unknown[],
  answers: Record<string, unknown>
): number {
  const questionList = questions as Array<{
    id: string;
    type: string;
    correctKey?: string;
    correctAnswer?: boolean;
  }>;

  let correct = 0;
  let gradable = 0;

  for (const q of questionList) {
    const answer = answers[q.id];

    if (q.type === "mcq" && q.correctKey !== undefined) {
      gradable++;
      if (answer === q.correctKey) correct++;
    } else if (q.type === "yesno" && q.correctAnswer !== undefined) {
      gradable++;
      if (answer === q.correctAnswer) correct++;
    } else if (q.type === "freetext") {
      gradable++;
      if (typeof answer === "string" && answer.trim().length >= 10) correct++;
    }
  }

  return gradable > 0 ? Math.round((correct / gradable) * 100) : 0;
}

/** Submits comprehension answers. Allows one retry on failure. */
export async function submitComprehension(
  userId: string,
  reviewId: string,
  payload: ComprehensionPayload
): Promise<
  Result<{
    passed: boolean;
    score: number;
    retryAvailable: boolean;
    feedback: string;
  }>
> {
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) return err(notFound("Review not found"));
  if (review.userId !== userId) return err(forbidden("Not your review"));

  if (review.screen1State === "completed") {
    return err(reviewNotEligible("Review already completed"));
  }

  if (!payload.oneLiner?.trim() || payload.oneLiner.trim().length < 5) {
    return err(validationError("One-liner must be at least 5 characters"));
  }

  const questions = (review.questionsPayload as { questions?: unknown[] })?.questions ?? generateFallbackQuestions("", "");
  const score = scoreAnswers(questions, payload.answers);
  const passed = score >= PASSING_SCORE;
  const retryAvailable = !passed && review.retryCount < MAX_RETRIES;

  if (passed) {
    await prisma.review.update({
      where: { id: reviewId },
      data: {
        screen1State: "completed",
        answersPayload: payload.answers as object,
        comprehensionScore: score,
        oneLiner: review.oneLiner ?? payload.oneLiner.trim(),
      },
    });
    return ok({
      passed: true,
      score,
      retryAvailable: false,
      feedback: "All answers correct. You may proceed to submission.",
    });
  }

  if (retryAvailable) {
    await prisma.review.update({
      where: { id: reviewId },
      data: {
        retryCount: review.retryCount + 1,
        answersPayload: payload.answers as object,
      },
    });
    return ok({
      passed: false,
      score,
      retryAvailable: true,
      feedback: `Score ${score}% is below the ${PASSING_SCORE}% threshold. Review the diff and try again.`,
    });
  }

  await prisma.review.update({
    where: { id: reviewId },
    data: {
      screen1State: "failed",
      answersPayload: payload.answers as object,
      comprehensionScore: score,
    },
  });

  return ok({
    passed: false,
    score,
    retryAvailable: false,
    feedback: `Score ${score}% after ${MAX_RETRIES + 1} attempts. Review has been marked as failed.`,
  });
}

/** Approves review after Screen 1 completion and moves job to approved. */
export async function approveReview(
  userId: string,
  reviewId: string,
  prType: "draft" | "ready_for_review" = "ready_for_review"
): Promise<Result<{ approved: boolean }>> {
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) return err(notFound("Review not found"));
  if (review.userId !== userId) return err(forbidden("Not your review"));

  if (review.screen1State !== "completed" && review.screen1State !== "questions_presented") {
    return err(reviewNotEligible("Review comprehension must be completed first"));
  }

  if (review.approvalTimestamp) {
    return err(reviewNotEligible("Review already approved"));
  }

  await prisma.$transaction([
    prisma.review.update({
      where: { id: reviewId },
      data: {
        approvalTimestamp: new Date(),
        screen2PrType: prType,
      },
    }),
    prisma.job.update({
      where: { id: review.jobId },
      data: { status: "approved" },
    }),
  ]);

  return ok({ approved: true });
}

/** Rejects review and archives. Moves job to rejected status. */
export async function rejectReview(
  userId: string,
  reviewId: string
): Promise<Result<{ rejected: boolean }>> {
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) return err(notFound("Review not found"));
  if (review.userId !== userId) return err(forbidden("Not your review"));

  if (review.approvalTimestamp) {
    return err(reviewNotEligible("Cannot reject an approved review"));
  }

  await prisma.job.update({
    where: { id: review.jobId },
    data: { status: "rejected" },
  });

  return ok({ rejected: true });
}

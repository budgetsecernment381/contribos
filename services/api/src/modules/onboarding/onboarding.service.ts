import { prisma } from "../../lib/prisma.js";
import type { Result } from "../../common/types/result.js";
import { ok, err } from "../../common/types/result.js";
import {
  notFound,
  validationError,
  internalError,
} from "../../common/errors/app-error.js";
import {
  computeTier,
  type CalibrationAnswers,
} from "./tiering.engine.js";
import { complete as llmComplete } from "../ai/llm.gateway.js";
import { fetchGitHubSignals } from "./github-profile.service.js";
import type { UserGoal, TimeBudget } from "@prisma/client";
import { z } from "zod";

const calibrationQuestionSchema = z.object({
  id: z.string(),
  type: z.enum(["mcq", "yes_no", "free_text"]),
  question: z.string(),
  options: z.array(z.string()).optional(),
});

const calibrationResponseSchema = z.array(calibrationQuestionSchema).min(3);

export interface OnboardingStatus {
  complete: boolean;
  hasGoals: boolean;
  hasCalibration: boolean;
  tier?: number;
}

export interface GoalsInput {
  goal: UserGoal;
  timeBudget: TimeBudget;
  ecosystems: string[];
}

export interface CalibrationQuestion {
  id: string;
  type: "mcq" | "yes_no" | "free_text";
  question: string;
  options?: string[];
}

export interface CalibrationPayload {
  questions: CalibrationQuestion[];
}

export interface TierResult {
  tier: number;
  rationale: string;
}

/**
 * Get onboarding status for a user.
 */
export async function getOnboardingStatus(
  userId: string
): Promise<Result<OnboardingStatus>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user) return err(notFound("User not found"));

  const ecosystemCount = await prisma.userEcosystem.count({
    where: { userId },
  });
  const hasGoals = !!(
    user.profile?.goal &&
    user.profile?.timeBudget &&
    ecosystemCount > 0
  );
  const hasCalibration = !!user.profile?.goal;

  return ok({
    complete: user.onboardingComplete,
    hasGoals,
    hasCalibration: hasCalibration && user.onboardingComplete,
    tier: user.tier,
  });
}

/**
 * Persist user goals and ecosystems.
 */
export async function saveGoals(
  userId: string,
  input: GoalsInput
): Promise<Result<void>> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.userProfile.upsert({
        where: { userId },
        create: {
          userId,
          goal: input.goal,
          timeBudget: input.timeBudget,
        },
        update: {
          goal: input.goal,
          timeBudget: input.timeBudget,
        },
      });

      await tx.userEcosystem.deleteMany({ where: { userId } });
      for (const name of input.ecosystems) {
        if (name.trim()) {
          await tx.userEcosystem.create({
            data: { userId, ecosystemName: name.trim() },
          });
        }
      }
    });
    return ok(undefined);
  } catch (e) {
    return err(internalError("Failed to save goals"));
  }
}

const DEFAULT_CALIBRATION_QUESTIONS: CalibrationQuestion[] = [
  {
    id: "q1",
    type: "mcq",
    question: "How often do you contribute to open source?",
    options: ["Never", "Occasionally", "Regularly", "I've contributed before"],
  },
  {
    id: "q2",
    type: "yes_no",
    question: "Have you submitted a pull request in the last 6 months?",
  },
  {
    id: "q3",
    type: "free_text",
    question: "Describe your approach when fixing a bug in unfamiliar code.",
  },
];

/**
 * Generate calibration questions via LLM gateway with fallback to defaults.
 */
export async function getCalibrationQuestions(
  userId: string
): Promise<Result<CalibrationPayload>> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
  });
  if (!profile?.goal) {
    return err(validationError("Complete goals first"));
  }

  try {
    const response = await llmComplete({
      workflow: "calibration",
      userId,
      messages: [
        {
          role: "system",
          content: `You generate calibration questions for an open-source contribution platform.
Return exactly 3 questions as JSON array. Each has: id (string), type ("mcq"|"yes_no"|"free_text"), question (string), and options (string[] for mcq only).
Questions should assess the contributor's experience level for the "${profile.goal}" goal.
Output ONLY the JSON array, no markdown or explanation.`,
        },
        {
          role: "user",
          content: `Generate 3 calibration questions for a contributor with goal "${profile.goal}" and time budget "${profile.timeBudget}".`,
        },
      ],
      maxTokens: 1024,
      temperature: 0.7,
    });

    const raw = JSON.parse(response.text);
    const validated = calibrationResponseSchema.safeParse(raw);
    if (validated.success) {
      return ok({ questions: validated.data.slice(0, 3) });
    }
  } catch {
    // LLM unavailable or response unparseable — fall back to defaults
  }

  return ok({ questions: DEFAULT_CALIBRATION_QUESTIONS });
}

/**
 * Submit calibration answers and compute tier.
 */
export async function submitCalibration(
  userId: string,
  answers: CalibrationAnswers
): Promise<Result<TierResult>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user) return err(notFound("User not found"));

  const signals = await fetchGitHubSignals(user.githubUsername);

  const { tier, rationale } = computeTier(
    signals,
    answers,
    user.profile?.goal ?? null,
    user.profile?.timeBudget ?? null
  );

  await prisma.user.update({
    where: { id: userId },
    data: {
      tier,
      onboardingComplete: true,
    },
  });

  return ok({ tier, rationale });
}

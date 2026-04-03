/**
 * Onboarding module contracts — shared types and validation schemas.
 */

import { z } from "zod";

export const goalsInputSchema = z.object({
  goal: z.enum(["job_hunt", "ecosystem_depth", "give_back", "explore"]),
  timeBudget: z.enum(["quick", "standard", "deep"]),
  ecosystems: z.array(z.string().min(1)).min(1).max(10),
});

export const calibrationAnswerSchema = z.object({
  familiarityLevel: z.enum(["never", "occasional", "regular", "contributed"]),
  fixIntent: z.enum(["minimal_safe", "correct_complete", "full_understanding"]),
  openEndedResponse: z.string().optional(),
});

export type GoalsInputDTO = z.infer<typeof goalsInputSchema>;
export type CalibrationAnswerDTO = z.infer<typeof calibrationAnswerSchema>;

export interface OnboardingStatusDTO {
  complete: boolean;
  hasGoals: boolean;
  hasCalibration: boolean;
  tier?: number;
}

export interface CalibrationQuestionDTO {
  id: string;
  type: "mcq" | "yes_no" | "free_text";
  question: string;
  options?: string[];
}

export interface TierResultDTO {
  tier: number;
  rationale: string;
}

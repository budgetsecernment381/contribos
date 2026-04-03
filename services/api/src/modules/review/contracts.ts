/**
 * Review module contracts — shared types and validation schemas.
 */

import { z } from "zod";

export const comprehensionSchema = z.object({
  answers: z.record(z.unknown()),
  oneLiner: z.string().min(5).max(500),
});

export const screen2Schema = z.object({
  prType: z.enum(["draft", "ready_for_review"]),
  commitStyle: z.enum(["conventional", "imperative"]),
});

export type ComprehensionDTO = z.infer<typeof comprehensionSchema>;
export type Screen2DTO = z.infer<typeof screen2Schema>;

export interface ReviewStateDTO {
  id: string;
  jobId: string;
  screen1State: string;
  comprehensionScore: number | null;
  oneLiner: string | null;
  retryCount: number;
  approvalTimestamp: Date | null;
  screen2PrType: string;
  screen2CommitStyle: string;
}

export interface ComprehensionResultDTO {
  passed: boolean;
  score: number;
  retryAvailable: boolean;
  feedback: string;
}

export interface Screen1ContentDTO {
  sectionA: string | null;
  sectionB: string | null;
  diffKey: string | null;
  questions: unknown[];
  state: string;
  unlockedSections: string[];
}

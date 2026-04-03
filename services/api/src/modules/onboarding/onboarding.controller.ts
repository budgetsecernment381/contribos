import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { getUserId } from "../../common/types/auth.js";
import {
  getOnboardingStatus,
  saveGoals,
  getCalibrationQuestions,
  submitCalibration,
} from "./onboarding.service.js";

const goalsSchema = z.object({
  goal: z.enum(["job_hunt", "ecosystem_depth", "give_back", "explore"]),
  timeBudget: z.enum(["quick", "standard", "deep"]),
  ecosystems: z.array(z.string().min(1)).min(1).max(10),
});

const calibrationSchema = z.object({
  familiarityLevel: z.enum(["never", "occasional", "regular", "contributed"]),
  fixIntent: z.enum(["minimal_safe", "correct_complete", "full_understanding"]),
  openEndedResponse: z.string().optional(),
});

/**
 * Register onboarding routes.
 */
export async function registerOnboardingRoutes(
  fastify: FastifyInstance
): Promise<void> {
  fastify.get(
    "/status",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await getOnboardingStatus(getUserId(req));
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.post(
    "/goals",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const parsed = goalsSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: parsed.error.flatten(),
        });
      }

      const result = await saveGoals(getUserId(req), parsed.data);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return { ok: true };
    }
  );

  fastify.get(
    "/calibration",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await getCalibrationQuestions(getUserId(req));
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.post(
    "/calibration",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const parsed = calibrationSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: parsed.error.flatten(),
        });
      }

      const result = await submitCalibration(getUserId(req), parsed.data);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.get(
    "/tier",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const statusResult = await getOnboardingStatus(getUserId(req));
      if (!statusResult.ok) {
        return reply
          .status(statusResult.error.statusCode)
          .send(statusResult.error.toJSON());
      }
      const user = await prisma.user.findUnique({
        where: { id: getUserId(req) },
      });
      if (!user) {
        return reply
          .status(404)
          .send({ code: "NOT_FOUND", message: "User not found" });
      }
      return {
        tier: user.tier,
        rationale: "Assigned during onboarding calibration.",
      };
    }
  );
}

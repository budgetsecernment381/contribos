import type { FastifyInstance } from "fastify";
import { getUserId } from "../../common/types/auth.js";
import { z } from "zod";
import {
  getReview,
  getScreen1Content,
  submitComprehension,
  approveReview,
  rejectReview,
} from "./review.service.js";

const comprehensionSchema = z.object({
  answers: z.record(z.unknown()),
  oneLiner: z.string().min(1).max(500),
});

/**
 * Register review routes.
 */
export async function registerReviewRoutes(
  fastify: FastifyInstance
): Promise<void> {
  fastify.get<{ Params: { reviewId: string } }>(
    "/:reviewId",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await getReview(getUserId(req), req.params.reviewId);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.get<{ Params: { reviewId: string } }>(
    "/:reviewId/screen1",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await getScreen1Content(getUserId(req), req.params.reviewId);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.post<{ Params: { reviewId: string } }>(
    "/:reviewId/comprehension",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const parsed = comprehensionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: parsed.error.flatten(),
        });
      }

      const result = await submitComprehension(
        getUserId(req),
        req.params.reviewId,
        parsed.data
      );
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.post<{ Params: { reviewId: string } }>(
    "/:reviewId/approve",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const body = req.body as { prType?: string } | undefined;
      const prType = body?.prType === "draft" ? "draft" : "ready_for_review";
      const result = await approveReview(getUserId(req), req.params.reviewId, prType);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.post<{ Params: { reviewId: string } }>(
    "/:reviewId/reject",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await rejectReview(getUserId(req), req.params.reviewId);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );
}

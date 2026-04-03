import type { FastifyInstance } from "fastify";
import { getUserId } from "../../common/types/auth.js";
import { z } from "zod";
import { createPR, listPRs, getPR } from "./pr.service.js";

const createPRSchema = z.object({
  reviewId: z.string().cuid(),
  idempotencyKey: z.string().min(1).max(128),
  disclosureText: z.string().max(2000).optional(),
  prType: z.enum(["draft", "ready_for_review"]).optional(),
  commitStyle: z.enum(["conventional", "imperative"]).optional(),
});

/**
 * Register PR routes.
 */
export async function registerPRRoutes(
  fastify: FastifyInstance
): Promise<void> {
  fastify.post(
    "/",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const parsed = createPRSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: parsed.error.flatten(),
        });
      }

      const result = await createPR(getUserId(req), parsed.data);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.get<{ Querystring: { state?: string; limit?: string } }>(
    "/",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const q = req.query;
      const state = q.state;
      const limit = Math.min(Number(q.limit) || 20, 50);
      const result = await listPRs(
        getUserId(req),
        state as "open" | "merged" | "closed" | "abandoned" | undefined,
        limit
      );
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.get<{ Params: { prId: string } }>(
    "/:prId",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await getPR(getUserId(req), req.params.prId);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );
}

import type { FastifyInstance } from "fastify";
import { getUserId } from "../../common/types/auth.js";
import {
  getReputationScore,
  getReputationHistory,
  applyContributionEvent,
} from "./reputation.service.js";

/**
 * Register reputation routes.
 */
export async function registerReputationRoutes(
  fastify: FastifyInstance
): Promise<void> {
  fastify.get(
    "/score",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await getReputationScore(getUserId(req));
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.get<{ Querystring: { limit?: string } }>(
    "/history",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const limit = Math.min(Number(req.query?.limit) || 50, 100);
      const result = await getReputationHistory(getUserId(req), limit);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.post<{ Body: { pullRequestId: string; eventType: string; chsDelta: number } }>(
    "/events",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const body = req.body as { pullRequestId: string; eventType: string; chsDelta: number };
      const validTypes = ["merged", "merged_with_changes", "closed", "abandoned", "comment_response", "review_completed"] as const;
      const eventType = body.eventType as (typeof validTypes)[number];
      if (!validTypes.includes(eventType)) {
        return reply.status(400).send({ code: "VALIDATION_ERROR", message: "Invalid event type" });
      }
      const result = await applyContributionEvent(
        getUserId(req),
        body.pullRequestId,
        eventType,
        body.chsDelta
      );
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );
}

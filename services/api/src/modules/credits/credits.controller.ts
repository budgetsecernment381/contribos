import type { FastifyInstance } from "fastify";
import { getUserId } from "../../common/types/auth.js";
import { z } from "zod";
import { getBalance, topUp, getHistory } from "./credits.service.js";

const topUpSchema = z.object({
  amount: z.number().int().min(1).max(100),
});

/**
 * Register credits routes.
 */
export async function registerCreditsRoutes(
  fastify: FastifyInstance
): Promise<void> {
  fastify.get(
    "/",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const balanceResult = await getBalance(getUserId(req));
      if (!balanceResult.ok) {
        return reply.status(balanceResult.error.statusCode).send(balanceResult.error.toJSON());
      }
      const historyResult = await getHistory(getUserId(req), 50);
      if (!historyResult.ok) {
        return reply.status(historyResult.error.statusCode).send(historyResult.error.toJSON());
      }
      return {
        ...balanceResult.data,
        transactions: historyResult.data,
      };
    }
  );

  fastify.get(
    "/balance",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await getBalance(getUserId(req));
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.post(
    "/top-up",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const parsed = topUpSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: parsed.error.flatten(),
        });
      }

      const result = await topUp(getUserId(req), parsed.data.amount);
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
      const result = await getHistory(getUserId(req), limit);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );
}

import type { FastifyInstance } from "fastify";
import { getHealth, getReady } from "./health.service.js";

/**
 * Register health routes (no auth).
 */
export async function registerHealthRoutes(
  fastify: FastifyInstance
): Promise<void> {
  fastify.get("/health", async (_req, reply) => {
    const status = await getHealth();
    const code = status.status === "ok" ? 200 : 503;
    return reply.status(code).send(status);
  });

  fastify.get("/ready", async (_req, reply) => {
    const status = await getReady();
    const code = status.ready ? 200 : 503;
    return reply.status(code).send(status);
  });
}

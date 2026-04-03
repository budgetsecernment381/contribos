/**
 * Correlation ID middleware — attaches a unique request ID for cross-service tracing.
 * Reads X-Request-ID from incoming headers or generates a new UUID.
 */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

export async function correlationIdPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.addHook("onRequest", async (request, reply) => {
    const incoming = request.headers["x-request-id"];
    const correlationId = typeof incoming === "string" && incoming.length > 0
      ? incoming
      : randomUUID();

    (request as typeof request & { correlationId: string }).correlationId = correlationId;
    reply.header("x-request-id", correlationId);

    request.log = request.log.child({ correlationId });
  });
}

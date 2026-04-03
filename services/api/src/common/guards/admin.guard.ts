import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Fastify preHandler hook that checks user.role === 'admin'.
 * Must be used after jwtGuard.
 */
export async function adminGuard(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.user) {
    reply.status(403).send({
      code: "FORBIDDEN",
      message: "Authentication required",
    });
    return;
  }
  const user = request.user as { role: string } | undefined;
  if (user?.role !== "admin") {
    return reply.status(403).send({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
}

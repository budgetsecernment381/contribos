import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Fastify preHandler hook that verifies JWT from Authorization header
 * or httpOnly accessToken cookie, and attaches user payload to request.
 * Expects: Authorization: Bearer <access_token>, or cookie accessToken.
 */
export async function jwtGuard(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const cookieToken = request.cookies.accessToken;
    if (cookieToken && !request.headers.authorization) {
      (request.headers as Record<string, string>).authorization = `Bearer ${cookieToken}`;
    }
    await request.jwtVerify();
    const payload = request.user as { id: string; role: string; tier: number };
    request.user = {
      id: payload.id,
      role: payload.role as "contributor" | "admin",
      tier: payload.tier ?? 1,
    };
  } catch {
    return reply.status(401).send({
      code: "UNAUTHORIZED",
      message: "Invalid or missing token",
    });
  }
}

/**
 * Optional JWT verification - attaches user if token present, does not fail if absent.
 */
export async function optionalJwtGuard(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return;
  try {
    await request.jwtVerify();
    const payload = request.user as { id: string; role: string; tier: number };
    request.user = {
      id: payload.id,
      role: payload.role as "contributor" | "admin",
      tier: payload.tier ?? 1,
    };
  } catch {
    // Ignore - optional auth
  }
}

import type { FastifyRequest } from "fastify";
import type { UserRole } from "@prisma/client";

export interface AuthUser {
  id: string;
  role: UserRole;
  tier: number;
}

export function getAuthUser(
  user: unknown
): AuthUser {
  return user as AuthUser;
}

/** Get the authenticated user ID from request. Use after authenticate preHandler. */
export function getUserId(req: FastifyRequest): string {
  return getAuthUser(req.user).id;
}

/** Get optional user ID (when using optionalJwtGuard). */
export function getOptionalUserId(req: FastifyRequest): string | undefined {
  const u = req.user as AuthUser | undefined;
  return u?.id;
}

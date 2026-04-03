import type { FastifyRequest, FastifyReply } from "fastify";
import type { UserRole } from "@prisma/client";

declare module "fastify" {
  interface FastifyRequest {
    user?: {
      id: string;
      role: UserRole;
      tier: number;
    };
  }

  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    jwtRefresh: { verify: (token: string) => object };
  }
}

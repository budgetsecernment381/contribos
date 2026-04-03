import type { FastifyInstance } from "fastify";
import { getUserId } from "../../common/types/auth.js";
import {
  getRecommendedIssues,
  getClaimedIssues,
  claimIssue,
  releaseClaim,
  getIssue,
  getEcosystems,
} from "./matching.service.js";
import { getSteppingStone } from "./stepping-stone.service.js";

/**
 * Register matching/issue routes.
 */
export async function registerMatchingRoutes(
  fastify: FastifyInstance
): Promise<void> {
  interface IssueQuery {
    page?: string;
    limit?: string;
    search?: string;
    ecosystem?: string;
    tier?: string;
    sort?: string;
  }

  const issueHandler = async (
    req: import("fastify").FastifyRequest<{ Querystring: IssueQuery }>,
    reply: import("fastify").FastifyReply
  ) => {
    const q = req.query;
    const result = await getRecommendedIssues(getUserId(req), {
      page: q.page ? parseInt(q.page) : undefined,
      limit: q.limit ? Math.min(parseInt(q.limit), 50) : undefined,
      search: q.search || undefined,
      ecosystem: q.ecosystem || undefined,
      tier: q.tier ? parseInt(q.tier) : undefined,
      sort: (q.sort as "score" | "prestige" | "newest") || undefined,
    });
    if (!result.ok) {
      return reply.status(result.error.statusCode).send(result.error.toJSON());
    }
    return result.data;
  };

  fastify.get<{ Querystring: IssueQuery }>(
    "/",
    { preHandler: [fastify.authenticate] },
    issueHandler
  );

  fastify.get<{ Querystring: IssueQuery }>(
    "/recommended",
    { preHandler: [fastify.authenticate] },
    issueHandler
  );

  fastify.get(
    "/claimed",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await getClaimedIssues(getUserId(req));
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.post<{ Params: { issueId: string } }>(
    "/:issueId/claim",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await claimIssue(getUserId(req), req.params.issueId);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return { ok: true };
    }
  );

  fastify.delete<{ Params: { issueId: string } }>(
    "/:issueId/claim",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await releaseClaim(getUserId(req), req.params.issueId);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return { ok: true };
    }
  );

  fastify.get<{ Params: { issueId: string } }>(
    "/:issueId",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await getIssue(getUserId(req), req.params.issueId);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.get(
    "/stepping-stone",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await getSteppingStone(getUserId(req));
      if (!result.ok) {
        return reply
          .status(result.error.statusCode)
          .send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.get(
    "/ecosystems",
    { preHandler: [fastify.authenticate] },
    async () => {
      return getEcosystems();
    }
  );
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { adminGuard } from "../../common/guards/admin.guard.js";
import {
  listRepos,
  addOrUpdateRepo,
  updatePrestigeGraph,
  getPolicy,
  updatePolicy,
  approveRepo,
  rejectRepo,
  triggerRepoSync,
  listUsers,
  updateUserCredits,
  backfillPrestigeTiers,
} from "./admin.service.js";
import {
  getJobStatuses,
  triggerJob,
  getJobNames,
} from "../../lib/scheduler.js";
import { prisma } from "../../lib/prisma.js";

const addRepoSchema = z.object({
  githubRepoId: z.number().int().positive(),
  fullName: z.string().min(1),
  ecosystem: z.string().min(1),
  allowlistState: z.enum(["pending", "approved", "rejected"]).optional(),
});

const prestigeGraphSchema = z.object({
  updates: z.array(
    z.object({
      repoId: z.string().cuid(),
      prestigeTier: z.enum(["entry", "mid", "high", "prestige"]),
      prestigeScore: z.number(),
    })
  ),
});

const policySchema = z.object({
  maxClaimsPerUser: z.number().int().min(1).max(50).optional(),
  reviewTimeoutHours: z.number().int().min(1).max(720).optional(),
  minTierForPrestige: z.number().int().min(1).max(4).optional(),
}).strict();

/**
 * Register admin routes.
 */
export async function registerAdminRoutes(
  fastify: FastifyInstance
): Promise<void> {
  const adminPreHandler = [fastify.authenticate, adminGuard];

  fastify.get(
    "/repos",
    { preHandler: adminPreHandler },
    async (_req, reply) => {
      const result = await listRepos();
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.post(
    "/repos",
    { preHandler: adminPreHandler },
    async (req, reply) => {
      const parsed = addRepoSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: parsed.error.flatten(),
        });
      }

      const result = await addOrUpdateRepo(parsed.data);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.get(
    "/policy",
    { preHandler: adminPreHandler },
    async (_req, reply) => {
      const result = await getPolicy();
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  const policyHandler = async (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    const parsed = policySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: parsed.error.flatten(),
      });
    }
    const result = await updatePolicy(parsed.data);
    if (!result.ok) {
      return reply.status(result.error.statusCode).send(result.error.toJSON());
    }
    return { ok: true };
  };

  fastify.patch("/policy", { preHandler: adminPreHandler }, policyHandler);
  fastify.put("/policy", { preHandler: adminPreHandler }, policyHandler);

  fastify.patch(
    "/prestige-graph",
    { preHandler: adminPreHandler },
    async (req, reply) => {
      const body = req.body as { repoId?: string; prestige?: number };
      if (!body.repoId) {
        return reply.status(400).send({ code: "VALIDATION_ERROR", message: "repoId required" });
      }
      const result = await updatePrestigeGraph([{
        repoId: body.repoId,
        prestigeTier: "mid",
        prestigeScore: body.prestige ?? 0,
      }]);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return { ok: true };
    }
  );

  fastify.put(
    "/prestige-graph",
    { preHandler: adminPreHandler },
    async (req, reply) => {
      const parsed = prestigeGraphSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: parsed.error.flatten(),
        });
      }

      const result = await updatePrestigeGraph(parsed.data.updates);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return { ok: true };
    }
  );

  // --- Repo approval/rejection/sync routes ---

  fastify.patch(
    "/repos/:id/approve",
    { preHandler: adminPreHandler },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const adminId = (req.user as { id: string }).id;
      const result = await approveRepo(id);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      req.log.info(`[admin] User ${adminId} approved repo ${id}`);
      return result.data;
    }
  );

  fastify.patch(
    "/repos/:id/reject",
    { preHandler: adminPreHandler },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const adminId = (req.user as { id: string }).id;
      const result = await rejectRepo(id);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      req.log.info(`[admin] User ${adminId} rejected repo ${id}`);
      return result.data;
    }
  );

  fastify.post(
    "/repos/:id/sync",
    { preHandler: adminPreHandler },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const adminId = (req.user as { id: string }).id;
      const result = await triggerRepoSync(id);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      req.log.info(`[admin] User ${adminId} triggered sync for repo ${id}`);
      return reply.status(202).send(result.data);
    }
  );

  // --- Scheduler / cron job management routes ---

  fastify.get(
    "/scheduler/status",
    { preHandler: adminPreHandler },
    async () => {
      const [
        issuesByStatus,
        issuesByEcosystem,
        reposByState,
        totalUsers,
      ] = await Promise.all([
        prisma.$queryRaw<Array<{ claim_status: string; count: bigint }>>`
          SELECT claim_status, count(*) FROM issues GROUP BY claim_status ORDER BY count DESC`,
        prisma.$queryRaw<Array<{ ecosystem: string; count: bigint }>>`
          SELECT r.ecosystem, count(i.id) AS count
          FROM issues i JOIN repositories r ON r.id = i.repository_id
          WHERE i.claim_status = 'available'
          GROUP BY r.ecosystem ORDER BY count DESC`,
        prisma.$queryRaw<Array<{ allowlist_state: string; count: bigint }>>`
          SELECT allowlist_state, count(*) FROM repositories GROUP BY allowlist_state`,
        prisma.user.count(),
      ]);

      const dbStats = {
        issues: Object.fromEntries(
          issuesByStatus.map((r) => [r.claim_status, Number(r.count)])
        ),
        issuesByEcosystem: Object.fromEntries(
          issuesByEcosystem.map((r) => [r.ecosystem, Number(r.count)])
        ),
        repos: Object.fromEntries(
          reposByState.map((r) => [r.allowlist_state, Number(r.count)])
        ),
        totalUsers,
      };

      return { jobs: getJobStatuses(), dbStats };
    }
  );

  fastify.post(
    "/scheduler/trigger/:jobName",
    { preHandler: adminPreHandler },
    async (req, reply) => {
      const { jobName } = req.params as { jobName: string };
      const validNames = getJobNames();
      if (!validNames.includes(jobName)) {
        return reply.status(400).send({
          code: "VALIDATION_ERROR",
          message: `Invalid job name. Valid names: ${validNames.join(", ")}`,
        });
      }
      const adminId = (req.user as { id: string }).id;
      const result = await triggerJob(jobName);
      if (!result.ok) {
        return reply.status(409).send({
          code: "CONFLICT",
          message: result.error,
        });
      }
      req.log.info(`[admin] User ${adminId} manually triggered job: ${jobName}`);
      return reply.status(202).send({ ok: true, jobName });
    }
  );

  // --- User management ---

  fastify.get(
    "/users",
    { preHandler: adminPreHandler },
    async () => {
      const result = await listUsers();
      if (!result.ok) return result.error.toJSON();
      return result.data;
    }
  );

  const updateCreditsSchema = z.object({
    amount: z.number().int().min(-1000).max(1000),
    reason: z.string().min(1).max(200),
  });

  fastify.post(
    "/users/:userId/credits",
    { preHandler: adminPreHandler },
    async (req, reply) => {
      const { userId } = req.params as { userId: string };
      const parsed = updateCreditsSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const adminId = (req.user as { id: string }).id;
      const result = await updateUserCredits(userId, parsed.data.amount, parsed.data.reason);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      req.log.info(`[admin] User ${adminId} updated credits for ${userId}: ${parsed.data.amount > 0 ? "+" : ""}${parsed.data.amount} (${parsed.data.reason})`);
      return result.data;
    }
  );

  // --- Prestige backfill ---

  fastify.post(
    "/backfill-prestige",
    { preHandler: adminPreHandler },
    async (_req, reply) => {
      const result = await backfillPrestigeTiers();
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

}

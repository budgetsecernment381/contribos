import type { FastifyInstance } from "fastify";
import { getUserId } from "../../common/types/auth.js";
import { z } from "zod";
import {
  createJob,
  listJobs,
  getJob,
  getJobArtifacts,
  getArtifactPresignedUrl,
  regenerateJob,
} from "./jobs.service.js";

const createJobSchema = z.object({
  issueId: z.string().cuid(),
  familiarityLevel: z.enum(["never", "occasional", "regular", "contributed"]),
  fixIntent: z.enum(["minimal_safe", "correct_complete", "full_understanding"]),
  freeContext: z.string().max(2000).optional(),
  llmProvider: z.enum(["anthropic", "openai", "google", "perplexity", "mistral", "groq", "deepseek", "xai"]).optional(),
  llmModel: z.string().min(1).optional(),
  llmProviderOverride: z.string().optional(),
});

/**
 * Register jobs routes.
 */
export async function registerJobsRoutes(
  fastify: FastifyInstance
): Promise<void> {
  fastify.get<{ Querystring: { limit?: string } }>(
    "/",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const limit = Math.min(Number(req.query?.limit) || 20, 50);
      const result = await listJobs(getUserId(req), limit);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.post(
    "/",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const parsed = createJobSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: parsed.error.flatten(),
        });
      }

      const result = await createJob(getUserId(req), parsed.data);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.get<{ Params: { jobId: string } }>(
    "/:jobId",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await getJob(getUserId(req), req.params.jobId);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.get<{ Params: { jobId: string } }>(
    "/:jobId/artifacts",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await getJobArtifacts(getUserId(req), req.params.jobId);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.get<{ Params: { jobId: string; key: string } }>(
    "/:jobId/artifacts/:key",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await getArtifactPresignedUrl(
        getUserId(req),
        req.params.jobId,
        req.params.key
      );
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return { url: result.data };
    }
  );

  fastify.post<{ Params: { jobId: string } }>(
    "/:jobId/regenerate",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await regenerateJob(getUserId(req), req.params.jobId);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );
}

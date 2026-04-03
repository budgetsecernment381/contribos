/**
 * Agent Provider Fastify controller — CRUD routes for A2A agent providers.
 * Mirrors custom-provider.controller.ts pattern.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { getUserId } from "../../common/types/auth.js";
import {
  createAgentProvider,
  listAgentProviders,
  updateAgentProvider,
  deleteAgentProvider,
  testAgentProvider,
  discoverAgent,
  discoverAgentFromUrl,
  setDefaultAgentProvider,
} from "./agent-provider.service.js";

function logProviderEvent(
  req: FastifyRequest,
  action: string,
  detail: Record<string, unknown>
) {
  req.log.info({
    msg: "agent_provider_event",
    action,
    userId: getUserId(req),
    ...detail,
  });
}

const createSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(64, "Name must be 64 characters or fewer")
    .regex(
      /^[a-zA-Z0-9 \-_]+$/,
      "Name can only contain letters, numbers, spaces, hyphens, and underscores"
    ),
  agentCardUrl: z.string().url("Must be a valid URL"),
  endpoint: z.string().url("Must be a valid URL"),
  apiKey: z.string().min(1).optional(),
  authScheme: z.enum(["bearer", "api-key"]).optional(),
  cachedSkills: z.unknown().optional(),
  cachedCapabilities: z.unknown().optional(),
});

const updateSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9 \-_]+$/)
    .optional(),
  apiKey: z.string().min(1).optional(),
  authScheme: z.enum(["bearer", "api-key"]).optional(),
});

const discoverSchema = z.object({
  agentCardUrl: z.string().url("Must be a valid URL"),
});

export async function registerAgentProviderRoutes(
  fastify: FastifyInstance
): Promise<void> {
  fastify.post(
    "/",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: parsed.error.flatten(),
        });
      }

      const result = await createAgentProvider(getUserId(req), parsed.data);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      logProviderEvent(req, "created", {
        providerId: result.data.id,
        name: parsed.data.name,
      });
      return reply.status(201).send(result.data);
    }
  );

  fastify.get(
    "/",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await listAgentProviders(getUserId(req));
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: parsed.error.flatten(),
        });
      }

      const result = await updateAgentProvider(
        getUserId(req),
        req.params.id,
        parsed.data
      );
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      logProviderEvent(req, "updated", { providerId: req.params.id });
      return result.data;
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await deleteAgentProvider(getUserId(req), req.params.id);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      logProviderEvent(req, "deleted", { providerId: req.params.id });
      return { ok: true };
    }
  );

  fastify.post<{ Params: { id: string } }>(
    "/:id/test",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await testAgentProvider(getUserId(req), req.params.id);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      logProviderEvent(req, "tested", {
        providerId: req.params.id,
        success: result.data.success,
        latencyMs: result.data.latencyMs,
      });
      return result.data;
    }
  );

  fastify.post<{ Params: { id: string } }>(
    "/:id/discover",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await discoverAgent(getUserId(req), req.params.id);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      logProviderEvent(req, "discovered", { providerId: req.params.id });
      return result.data;
    }
  );

  fastify.post(
    "/discover",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const parsed = discoverSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: parsed.error.flatten(),
        });
      }

      const result = await discoverAgentFromUrl(parsed.data.agentCardUrl);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      logProviderEvent(req, "discovered_url", {
        agentCardUrl: parsed.data.agentCardUrl,
      });
      return result.data;
    }
  );

  fastify.post<{ Params: { id: string } }>(
    "/:id/default",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await setDefaultAgentProvider(
        getUserId(req),
        req.params.id
      );
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      logProviderEvent(req, "set_default", { providerId: req.params.id });
      return { ok: true };
    }
  );

  fastify.delete(
    "/default",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await setDefaultAgentProvider(getUserId(req), null);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      logProviderEvent(req, "cleared_default", {});
      return { ok: true };
    }
  );
}

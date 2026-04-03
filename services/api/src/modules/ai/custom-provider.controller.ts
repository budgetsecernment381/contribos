import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { getUserId } from "../../common/types/auth.js";
import {
  createCustomProvider,
  listCustomProviders,
  updateCustomProvider,
  deleteCustomProvider,
  testCustomProvider,
  setCustomProviderDefault,
} from "./custom-provider.service.js";
import { validateAgentUrl } from "./a2a-client.service.js";

function logProviderEvent(
  req: FastifyRequest,
  action: string,
  detail: Record<string, unknown>
) {
  req.log.info({ msg: "custom_provider_event", action, userId: getUserId(req), ...detail });
}

const createSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(64, "Name must be 64 characters or fewer")
    .regex(/^[a-zA-Z0-9 \-_]+$/, "Name can only contain letters, numbers, spaces, hyphens, and underscores"),
  baseUrl: z.string().url("Must be a valid URL").refine(
    (url) => validateAgentUrl(url).ok,
    "URL must not point to a private or internal network address"
  ),
  apiKey: z.string().min(1, "API key is required"),
  modelId: z.string().min(1, "Model ID is required"),
});

const updateSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9 \-_]+$/)
    .optional(),
  baseUrl: z.string().url().refine(
    (url) => validateAgentUrl(url).ok,
    "URL must not point to a private or internal network address"
  ).optional(),
  apiKey: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
});

export async function registerCustomProviderRoutes(
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

      const result = await createCustomProvider(getUserId(req), parsed.data);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      logProviderEvent(req, "created", { providerId: result.data.id, name: parsed.data.name });
      return reply.status(201).send(result.data);
    }
  );

  fastify.get(
    "/",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await listCustomProviders(getUserId(req));
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

      const result = await updateCustomProvider(
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
      const result = await deleteCustomProvider(getUserId(req), req.params.id);
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
      const result = await testCustomProvider(getUserId(req), req.params.id);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      logProviderEvent(req, "tested", { providerId: req.params.id, success: result.data.success, latencyMs: result.data.latencyMs });
      return result.data;
    }
  );

  fastify.post<{ Params: { id: string } }>(
    "/:id/default",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await setCustomProviderDefault(
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
      const result = await setCustomProviderDefault(getUserId(req), null);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      logProviderEvent(req, "cleared_default", {});
      return { ok: true };
    }
  );
}

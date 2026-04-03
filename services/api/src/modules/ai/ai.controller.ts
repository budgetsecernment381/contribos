/**
 * AI module controller — exposes the provider catalog discovery endpoint
 * and user LLM preferences management.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getUserId } from "../../common/types/auth.js";
import { adminGuard } from "../../common/guards/admin.guard.js";
import {
  getAvailableCatalog,
  getFullCatalog,
  validateProviderModel,
} from "./provider-catalog.js";
import { prisma } from "../../lib/prisma.js";
import { listCustomProviders } from "./custom-provider.service.js";
import { listAgentProviders } from "./agent-provider.service.js";

const llmPrefsSchema = z.object({
  preferredLlmProvider: z.enum(["anthropic", "openai", "google", "perplexity", "mistral", "groq", "deepseek", "xai"]),
  preferredLlmModel: z.string().min(1),
});

/** Register AI routes under /api/v1/ai. */
export async function registerAiRoutes(
  fastify: FastifyInstance
): Promise<void> {
  fastify.get(
    "/providers",
    { preHandler: [fastify.authenticate] },
    async (req, _reply) => {
      const catalog = getAvailableCatalog();
      const builtIn = catalog.map((p) => ({
        id: p.id,
        name: p.name,
        source: "built_in" as const,
        models: p.models.map((m) => ({
          id: m.id,
          name: m.name,
          maxTokens: m.maxTokens,
          supportsTools: m.supportsTools,
        })),
      }));

      const customResult = await listCustomProviders(getUserId(req));
      const custom = customResult.ok
        ? customResult.data.map((cp) => ({
            id: `custom:${cp.id}`,
            name: cp.name,
            source: "custom" as const,
            baseUrl: cp.baseUrl,
            maskedApiKey: cp.maskedApiKey,
            isDefault: cp.isDefault,
            models: [{ id: cp.modelId, name: cp.modelId, maxTokens: 0, supportsTools: false }],
          }))
        : [];

      const agentResult = await listAgentProviders(getUserId(req));
      const agents = agentResult.ok
        ? agentResult.data.map((ap) => ({
            id: `agent:${ap.id}`,
            name: ap.name,
            source: "agent" as const,
            endpoint: ap.endpoint,
            maskedApiKey: ap.maskedApiKey,
            isDefault: ap.isDefault,
            skills: ap.cachedSkills,
            models: [],
          }))
        : [];

      return { providers: [...builtIn, ...custom, ...agents] };
    }
  );

  fastify.get(
    "/providers/all",
    { preHandler: [fastify.authenticate, adminGuard] },
    async (_req, _reply) => {
      return { providers: getFullCatalog() };
    }
  );

  fastify.get(
    "/preferences",
    { preHandler: [fastify.authenticate] },
    async (req, _reply) => {
      const profile = await prisma.userProfile.findUnique({
        where: { userId: getUserId(req) },
        select: {
          preferredLlmProvider: true,
          preferredLlmModel: true,
        },
      });
      return {
        preferredLlmProvider: profile?.preferredLlmProvider ?? null,
        preferredLlmModel: profile?.preferredLlmModel ?? null,
      };
    }
  );

  fastify.put(
    "/preferences",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const parsed = llmPrefsSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: parsed.error.flatten(),
        });
      }

      const validation = validateProviderModel(
        parsed.data.preferredLlmProvider,
        parsed.data.preferredLlmModel
      );
      if (!validation.valid) {
        return reply.status(400).send({
          code: "VALIDATION_ERROR",
          message: validation.reason,
        });
      }

      await prisma.userProfile.upsert({
        where: { userId: getUserId(req) },
        create: {
          userId: getUserId(req),
          preferredLlmProvider: parsed.data.preferredLlmProvider,
          preferredLlmModel: parsed.data.preferredLlmModel,
        },
        update: {
          preferredLlmProvider: parsed.data.preferredLlmProvider,
          preferredLlmModel: parsed.data.preferredLlmModel,
        },
      });

      return { ok: true };
    }
  );
}

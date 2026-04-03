import type { FastifyInstance } from "fastify";
import { getUserId, getOptionalUserId } from "../../common/types/auth.js";
import { z } from "zod";
import {
  getProfileSettings,
  updateProfileSettings,
  getPublicProfile,
} from "./profile.service.js";
import {
  buildProfileProjection,
  buildDashboardProjection,
} from "./profile-projection.service.js";
import { generateDataExport } from "./data-export.service.js";
import { deleteAccount } from "./account-deletion.service.js";
import { optionalJwtGuard } from "../../common/guards/jwt.guard.js";
import { prisma } from "../../lib/prisma.js";

const updateSettingsSchema = z.object({
  visibility: z.enum(["public", "link_only", "private"]).optional(),
  shareableSlug: z.string().min(1).max(64).optional().nullable(),
  headline: z.string().max(200).optional().nullable(),
  bio: z.string().max(1000).optional().nullable(),
  preferredLlmProvider: z.enum(["anthropic", "openai", "google", "perplexity", "mistral", "groq", "deepseek", "xai"]).optional().nullable(),
  preferredLlmModel: z.string().min(1).optional().nullable(),
});

/**
 * Register profile routes.
 */
export async function registerProfileRoutes(
  fastify: FastifyInstance
): Promise<void> {
  fastify.get(
    "/settings",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await getProfileSettings(getUserId(req));
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  const settingsHandler = async (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: parsed.error.flatten(),
      });
    }

    const result = await updateProfileSettings(getUserId(req), parsed.data);
    if (!result.ok) {
      return reply.status(result.error.statusCode).send(result.error.toJSON());
    }
    return result.data;
  };

  fastify.put("/settings", { preHandler: [fastify.authenticate] }, settingsHandler);
  fastify.patch("/settings", { preHandler: [fastify.authenticate] }, settingsHandler);

  fastify.get(
    "/dashboard",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await buildDashboardProjection(getUserId(req));
      if (!result.ok) {
        return reply
          .status(result.error.statusCode)
          .send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.get<{ Params: { slug: string } }>(
    "/view/:slug",
    { preHandler: [optionalJwtGuard] },
    async (req, reply) => {
      const result = await buildProfileProjection(
        req.params.slug,
        getOptionalUserId(req)
      );
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
    async (req) => {
      const rows = await prisma.userEcosystem.findMany({
        where: { userId: getUserId(req) },
        select: { ecosystemName: true },
        orderBy: { ecosystemName: "asc" },
      });
      return { ecosystems: rows.map((r) => r.ecosystemName) };
    }
  );

  const updateEcosystemsSchema = z.object({
    ecosystems: z.array(z.string().min(1)).min(1, "Select at least one ecosystem").max(20),
  });

  fastify.put(
    "/ecosystems",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const parsed = updateEcosystemsSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const userId = getUserId(req);
      await prisma.$transaction(async (tx) => {
        await tx.userEcosystem.deleteMany({ where: { userId } });
        for (const name of parsed.data.ecosystems) {
          if (name.trim()) {
            await tx.userEcosystem.create({
              data: { userId, ecosystemName: name.trim() },
            });
          }
        }
      });
      return { ok: true, ecosystems: parsed.data.ecosystems };
    }
  );

  fastify.get(
    "/data-export",
    {
      preHandler: [fastify.authenticate],
      config: {
        rateLimit: { max: 3, timeWindow: "1 hour" },
      },
    },
    async (req, reply) => {
      const result = await generateDataExport(getUserId(req));
      if (!result.ok) {
        return reply
          .status(result.error.statusCode)
          .send(result.error.toJSON());
      }
      return result.data;
    }
  );

  const deleteAccountSchema = z.object({
    confirm: z.literal("DELETE"),
  });

  fastify.delete(
    "/account",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const parsed = deleteAccountSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_ERROR",
          message: 'Send { "confirm": "DELETE" } to confirm irreversible account deletion',
        });
      }

      const result = await deleteAccount(getUserId(req));
      if (!result.ok) {
        return reply
          .status(result.error.statusCode)
          .send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.get<{ Params: { slug: string } }>(
    "/:slug",
    { preHandler: [optionalJwtGuard] },
    async (req, reply) => {
      const result = await getPublicProfile(
        req.params.slug,
        getOptionalUserId(req)
      );
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );
}

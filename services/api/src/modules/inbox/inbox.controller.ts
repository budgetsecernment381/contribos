import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getUserId } from "../../common/types/auth.js";
import { getEnv } from "../../common/config/env.js";
import { prisma } from "../../lib/prisma.js";
import {
  listInboxItems,
  getInboxItem,
  acknowledgeItem,
  processCommentWebhook,
} from "./inbox.service.js";
import { verifyWebhookSignature } from "./inbox.webhook.js";

/**
 * Register inbox routes.
 */
export async function registerInboxRoutes(
  fastify: FastifyInstance
): Promise<void> {
  fastify.get<{ Querystring: { prId?: string; commentType?: string; acknowledged?: string; limit?: string } }>(
    "/",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const q = req.query;
      const filters = {
        prId: q.prId,
        commentType: q.commentType as import("@prisma/client").CommentType | undefined,
        acknowledged:
          q.acknowledged === "true"
            ? true
            : q.acknowledged === "false"
              ? false
              : undefined,
      };
      const limit = Math.min(Number(q.limit) || 50, 100);
      const result = await listInboxItems(getUserId(req), filters, limit);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.get<{ Params: { itemId: string } }>(
    "/:itemId",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await getInboxItem(getUserId(req), req.params.itemId);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return result.data;
    }
  );

  fastify.post<{ Params: { itemId: string } }>(
    "/:itemId/acknowledge",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const result = await acknowledgeItem(getUserId(req), req.params.itemId);
      if (!result.ok) {
        return reply.status(result.error.statusCode).send(result.error.toJSON());
      }
      return { ok: true };
    }
  );
}

/**
 * Register GitHub webhook route (at /api/v1/webhooks/github).
 */
export async function registerWebhookRoute(
  fastify: FastifyInstance
): Promise<void> {
  fastify.post("/github", async (req: FastifyRequest, reply: FastifyReply) => {
    const env = getEnv();
    const secret = env.GITHUB_WEBHOOK_SECRET ?? "";
    if (!secret) {
      return reply.status(500).send({
        code: "INTERNAL_ERROR",
        message: "Webhook secret not configured",
      });
    }

    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const rawBody =
      (req as FastifyRequest & { rawBody?: string }).rawBody ??
      JSON.stringify(req.body ?? {});

    if (!verifyWebhookSignature(rawBody, signature, secret)) {
      return reply.status(401).send({
        code: "UNAUTHORIZED",
        message: "Invalid webhook signature",
      });
    }

    const payload = req.body as {
      action?: string;
      comment?: { id: number; body: string };
      pull_request?: { id: number };
    };

    if (payload.action === "created" && payload.comment && payload.pull_request) {
      const pr = await prisma.pullRequest.findFirst({
        where: { githubPrId: payload.pull_request.id },
      });
      if (pr) {
        processCommentWebhook(
          pr.id,
          pr.userId,
          payload.comment.id,
          payload.comment.body
        ).catch((e) => {
          req.log.error({ err: e, prId: pr.id }, "Background webhook processing failed");
        });
      }
    }

    return reply.status(200).send({ ok: true });
  });
}

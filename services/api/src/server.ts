import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { getEnv } from "./common/config/env.js";
import { errorHandler } from "./common/middleware/error-handler.js";
import { jwtGuard } from "./common/guards/jwt.guard.js";
import { registerAuthRoutes } from "./modules/auth/auth.controller.js";
import { registerOnboardingRoutes } from "./modules/onboarding/onboarding.controller.js";
import { registerMatchingRoutes } from "./modules/matching/matching.controller.js";
import { registerJobsRoutes } from "./modules/jobs/jobs.controller.js";
import { registerReviewRoutes } from "./modules/review/review.controller.js";
import { registerPRRoutes } from "./modules/pr/pr.controller.js";
import {
  registerInboxRoutes,
  registerWebhookRoute,
} from "./modules/inbox/inbox.controller.js";
import { registerReputationRoutes } from "./modules/reputation/reputation.controller.js";
import { registerProfileRoutes } from "./modules/profile/profile.controller.js";
import { registerCreditsRoutes } from "./modules/credits/credits.controller.js";
import { registerAdminRoutes } from "./modules/admin/admin.controller.js";
import { registerHealthRoutes } from "./modules/health/health.controller.js";
import { registerAiRoutes } from "./modules/ai/ai.controller.js";
import { registerCustomProviderRoutes } from "./modules/ai/custom-provider.controller.js";
import { registerAgentProviderRoutes } from "./modules/ai/agent-provider.controller.js";
import { registerNominationRoutes } from "./modules/sync/nomination.controller.js";
import { startWorker, stopWorker } from "./lib/worker.js";
import { startSyncWorker, stopSyncWorker } from "./lib/sync-worker.js";
import { closeQueue } from "./lib/queue.js";
import { closeSyncQueue } from "./lib/sync-queue.js";
import { closeRedis } from "./lib/redis.js";
import { prisma } from "./lib/prisma.js";
import { setGatewayLogger } from "./modules/ai/llm.gateway.js";
import { startScheduler, stopScheduler } from "./lib/scheduler.js";
import { correlationIdPlugin } from "./common/middleware/correlation-id.js";
import jwtLib from "jsonwebtoken";

function hasPinoPretty(): boolean {
  try {
    require.resolve("pino-pretty");
    return true;
  } catch {
    return false;
  }
}

async function buildServer() {
  const env = getEnv();

  const usePretty = env.NODE_ENV === "development" && hasPinoPretty();

  const fastify = Fastify({
    logger: {
      level: env.NODE_ENV === "development" ? "info" : "warn",
      transport: usePretty
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
    },
  });

  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body, done) => {
      (req as typeof req & { rawBody: Buffer }).rawBody = body as Buffer;
      const str = (body as Buffer).toString();
      if (!str.trim()) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(str));
      } catch (e) {
        done(e as Error, undefined);
      }
    }
  );

  await fastify.register(cors, {
    origin: env.NODE_ENV === "production" && env.CORS_ORIGIN === "*"
      ? false
      : env.CORS_ORIGIN,
    credentials: true,
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  await fastify.register(cookie, {
    secret: env.JWT_SECRET.slice(0, 32),
  });

  await fastify.register(jwt, {
    secret: env.JWT_SECRET,
    sign: {
      expiresIn: "15m",
    },
  });

  fastify.decorate("signAccess", function (payload: object) {
    return jwtLib.sign(payload, env.JWT_SECRET, { expiresIn: "15m" });
  });

  fastify.decorate("signRefresh", function (payload: object) {
    return jwtLib.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: "7d" });
  });

  fastify.decorate("jwtRefresh", {
    verify: (token: string) =>
      jwtLib.verify(token, env.JWT_REFRESH_SECRET) as object,
  });

  fastify.decorate("authenticate", jwtGuard);

  await fastify.register(correlationIdPlugin);

  fastify.setErrorHandler(errorHandler);

  fastify.register(
    async (scope) => {
      scope.register(registerAuthRoutes, { prefix: "/auth" });
      scope.register(registerOnboardingRoutes, { prefix: "/onboarding" });
      scope.register(registerMatchingRoutes, { prefix: "/issues" });
      scope.register(registerJobsRoutes, { prefix: "/jobs" });
      scope.register(registerReviewRoutes, { prefix: "/reviews" });
      scope.register(registerPRRoutes, { prefix: "/prs" });
      scope.register(registerInboxRoutes, { prefix: "/inbox" });
      scope.register(registerWebhookRoute, { prefix: "/webhooks" });
      scope.register(registerReputationRoutes, { prefix: "/reputation" });
      scope.register(registerProfileRoutes, { prefix: "/profile" });
      scope.register(registerCreditsRoutes, { prefix: "/credits" });
      scope.register(registerAdminRoutes, { prefix: "/admin" });
      scope.register(registerAiRoutes, { prefix: "/ai" });
      scope.register(registerCustomProviderRoutes, { prefix: "/custom-providers" });
      scope.register(registerAgentProviderRoutes, { prefix: "/agent-providers" });
      scope.register(registerNominationRoutes, { prefix: "/repos" });
      scope.register(registerHealthRoutes);
    },
    { prefix: "/api/v1" }
  );

  setGatewayLogger(fastify.log);
  startWorker();
  startSyncWorker();
  startScheduler();

  return fastify;
}

async function main() {
  const env = getEnv();
  const fastify = await buildServer();

  const shutdown = async (signal: string) => {
    fastify.log.info(`Received ${signal}, starting graceful shutdown`);
    try {
      stopScheduler();
      await stopWorker();
      await stopSyncWorker();
      await fastify.close();
      await closeQueue();
      await closeSyncQueue();
      await closeRedis();
      await prisma.$disconnect();
      fastify.log.info("Server closed gracefully");
      process.exit(0);
    } catch (shutdownErr) {
      fastify.log.error(shutdownErr, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  try {
    await fastify.listen({ port: env.PORT, host: "0.0.0.0" });
    fastify.log.info(`Server listening on port ${env.PORT}`);
  } catch (listenErr) {
    fastify.log.error(listenErr);
    process.exit(1);
  }
}

main();

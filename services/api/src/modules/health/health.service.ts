import { prisma } from "../../lib/prisma.js";
import { getRedis } from "../../lib/redis.js";
import { getAgentQueue } from "../../lib/queue.js";
import pino from "pino";

const logger = pino({ name: "health" });

export interface HealthStatus {
  status: "ok" | "degraded";
  database: "ok" | "error";
  redis: "ok" | "error";
  queue: "ok" | "error";
  timestamp: string;
}

export interface ReadyStatus {
  ready: boolean;
  checks: {
    database: boolean;
    redis: boolean;
    queue: boolean;
  };
}

/**
 * Check DB, Redis, queue connectivity.
 */
export async function getHealth(): Promise<HealthStatus> {
  const timestamp = new Date().toISOString();
  let dbOk = false;
  let redisOk = false;
  let queueOk = false;

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (e) {
    logger.error("[health] Database check failed: %s", (e as Error).message);
  }

  try {
    const redis = getRedis();
    await redis.ping();
    redisOk = true;
  } catch (e) {
    logger.error("[health] Redis check failed: %s", (e as Error).message);
  }

  try {
    const queue = getAgentQueue();
    await queue.getJobCounts();
    queueOk = true;
  } catch (e) {
    logger.error("[health] Queue check failed: %s", (e as Error).message);
  }

  const status =
    dbOk && redisOk && queueOk ? "ok" : "degraded";

  return {
    status,
    database: dbOk ? "ok" : "error",
    redis: redisOk ? "ok" : "error",
    queue: queueOk ? "ok" : "error",
    timestamp,
  };
}

/**
 * Readiness: true only when all dependencies connected.
 */
export async function getReady(): Promise<ReadyStatus> {
  const checks = {
    database: false,
    redis: false,
    queue: false,
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch (e) {
    logger.error("[ready] Database check failed: %s", (e as Error).message);
  }

  try {
    const redis = getRedis();
    await redis.ping();
    checks.redis = true;
  } catch (e) {
    logger.error("[ready] Redis check failed: %s", (e as Error).message);
  }

  try {
    const queue = getAgentQueue();
    await queue.getJobCounts();
    checks.queue = true;
  } catch (e) {
    logger.error("[ready] Queue check failed: %s", (e as Error).message);
  }

  return {
    ready: checks.database && checks.redis && checks.queue,
    checks,
  };
}

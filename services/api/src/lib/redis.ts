import Redis from "ioredis";
import { getEnv } from "../common/config/env.js";

let redis: Redis | null = null;

/**
 * Redis/IORedis connection singleton.
 * Used by BullMQ and for caching.
 */
export function getRedis(): Redis {
  if (!redis) {
    const env = getEnv();
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      },
    });
  }
  return redis;
}

/**
 * Close Redis connection (for graceful shutdown).
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

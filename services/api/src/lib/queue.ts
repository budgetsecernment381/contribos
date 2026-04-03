import { Queue } from "bullmq";
import { getEnv } from "../common/config/env.js";

const QUEUE_NAME = "agent-jobs";

let agentQueue: Queue | null = null;

/**
 * BullMQ queue for agent jobs.
 * Workers consume from this queue to process fix generation.
 */
export function getAgentQueue(): Queue {
  if (!agentQueue) {
    const env = getEnv();
    const url = new URL(env.REDIS_URL);
    agentQueue = new Queue(QUEUE_NAME, {
      connection: {
        host: url.hostname,
        port: url.port ? parseInt(url.port, 10) : 6379,
        ...(url.password && { password: url.password }),
        ...(url.username && { username: url.username }),
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return agentQueue;
}

/**
 * Close queue connection (for graceful shutdown).
 */
export async function closeQueue(): Promise<void> {
  if (agentQueue) {
    await agentQueue.close();
    agentQueue = null;
  }
}

import { Queue } from "bullmq";
import { getEnv } from "../common/config/env.js";

const QUEUE_NAME = "issue-sync";

let syncQueue: Queue | null = null;

export function getSyncQueue(): Queue {
  if (!syncQueue) {
    const env = getEnv();
    const url = new URL(env.REDIS_URL);
    syncQueue = new Queue(QUEUE_NAME, {
      connection: {
        host: url.hostname,
        port: url.port ? parseInt(url.port, 10) : 6379,
        ...(url.password && { password: url.password }),
        ...(url.username && { username: url.username }),
      },
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 2000 },
      },
    });
  }
  return syncQueue;
}

export async function closeSyncQueue(): Promise<void> {
  if (syncQueue) {
    await syncQueue.close();
    syncQueue = null;
  }
}

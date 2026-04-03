import { Worker } from "bullmq";
import pino from "pino";
import { getEnv } from "../common/config/env.js";
import { syncRepoIssues } from "../modules/sync/issue-sync.service.js";

const logger = pino({ name: "sync-worker" });

const QUEUE_NAME = "issue-sync";

interface SyncJobData {
  repoId: string;
}

let syncWorker: Worker | null = null;

export function startSyncWorker(): void {
  if (syncWorker) return;

  const env = getEnv();
  const url = new URL(env.REDIS_URL);

  syncWorker = new Worker<SyncJobData>(
    QUEUE_NAME,
    async (job) => {
      logger.info(
        { jobId: job.id, repoId: job.data.repoId },
        "Processing issue-sync job"
      );
      const result = await syncRepoIssues(job.data.repoId);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    {
      connection: {
        host: url.hostname,
        port: url.port ? parseInt(url.port, 10) : 6379,
        ...(url.password && { password: url.password }),
        ...(url.username && { username: url.username }),
      },
      concurrency: 1,
    }
  );

  syncWorker.on("failed", (job, error) => {
    logger.error(
      { jobId: job?.id, err: error },
      "Issue-sync job failed"
    );
  });

  syncWorker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Issue-sync job completed");
  });

  logger.info("Started issue-sync worker");
}

export async function stopSyncWorker(): Promise<void> {
  if (syncWorker) {
    await syncWorker.close();
    syncWorker = null;
    logger.info("Stopped issue-sync worker");
  }
}

import { Worker, Job } from "bullmq";
import { prisma } from "./prisma.js";
import { getEnv } from "../common/config/env.js";
import { evaluateGate } from "../modules/jobs/gates.service.js";

import { getDecryptedProvider } from "../modules/ai/custom-provider.service.js";
import { getDecryptedAgentProvider } from "../modules/ai/agent-provider.service.js";
import type { LlmProvider } from "@prisma/client";

interface WorkerJobData {
  jobId: string;
  issueId: string;
  llmProvider?: LlmProvider;
  llmModel?: string;
  llmProviderOverride?: string;
}

const QUEUE_NAME = "agent-jobs";

let worker: Worker | null = null;

/** Starts the BullMQ worker that consumes agent jobs and bridges to the Python worker via HTTP. */
export function startWorker(): void {
  const env = getEnv();
  const redisUrl = new URL(env.REDIS_URL);
  const workerUrl = env.WORKER_URL ?? "http://localhost:8000";

  worker = new Worker(
    QUEUE_NAME,
    async (job: Job<WorkerJobData>) => {
      const { jobId } = job.data;

      await prisma.job.update({
        where: { id: jobId },
        data: { status: "running" },
      });

      const dbJob = await prisma.job.findUnique({
        where: { id: jobId },
        include: { issue: { include: { repository: true } }, user: true },
      });
      if (!dbJob) throw new Error(`Job ${jobId} not found`);

      const issue = dbJob.issue;
      const repo = issue.repository;

      let artifacts: {
        diff: string;
        execution_trace: string;
        confidence_score: number;
        test_results: string;
        changed_files: string[];
        summary: string;
        risk_flags: string[];
      };

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (env.WORKER_SERVICE_TOKEN) {
          headers.Authorization = `Bearer ${env.WORKER_SERVICE_TOKEN}`;
        }

        const workerPayload: Record<string, unknown> = {
          job_id: jobId,
          issue_url: `https://github.com/${repo.fullName}/issues/${issue.githubIssueId}`,
          repo_url: `https://github.com/${repo.fullName}.git`,
          familiarity_level: dbJob.familiarityLevel,
          fix_intent: dbJob.fixIntent,
          free_context: dbJob.freeContext ?? "",
          llm_provider: dbJob.llmProvider,
          llm_model: dbJob.llmModel,
          issue_title: issue.title,
          issue_body: issue.body ?? "",
          issue_labels: issue.labels,
        };

        if (dbJob.llmProviderOverride?.startsWith("custom:")) {
          const customId = dbJob.llmProviderOverride.replace("custom:", "");
          const customResult = await getDecryptedProvider(dbJob.userId, customId);
          if (customResult.ok) {
            workerPayload.custom_provider_base_url = customResult.data.baseUrl;
            workerPayload.custom_provider_api_key = customResult.data.apiKey;
            workerPayload.custom_provider_model = customResult.data.modelId;
          }
        }

        if (dbJob.llmProviderOverride?.startsWith("agent:")) {
          const agentId = dbJob.llmProviderOverride.replace("agent:", "");
          const agentResult = await getDecryptedAgentProvider(dbJob.userId, agentId);
          if (agentResult.ok) {
            workerPayload.agent_provider_endpoint = agentResult.data.endpoint;
            workerPayload.agent_provider_api_key = agentResult.data.apiKey;
            workerPayload.agent_provider_auth_scheme = agentResult.data.authScheme;
            workerPayload.agent_provider_name = agentResult.data.name;
          }
        }

        const res = await fetch(`${workerUrl}/execute`, {
          method: "POST",
          headers,
          body: JSON.stringify(workerPayload),
        });

        const body = (await res.json()) as {
          ok: boolean;
          artifacts?: typeof artifacts;
          error?: string;
        };

        if (!body.ok || !body.artifacts) {
          const failureReason = body.error ?? "Worker returned no artifacts";
          await prisma.job.update({
            where: { id: jobId },
            data: {
              status: "failed",
              riskFlags: { failureReason },
            },
          });
          return;
        }

        artifacts = body.artifacts;
      } catch (e) {
        const failureReason =
          e instanceof Error ? e.message : "Worker request failed";
        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: "failed",
            riskFlags: { failureReason },
          },
        });
        return;
      }

      const gateResult = evaluateGate({
        confidenceScore: artifacts.confidence_score,
        diffLinesChanged: artifacts.diff
          .split("\n")
          .filter((l) => l.trim()).length,
        tier: dbJob.user.tier,
        repoArchived: repo.isArchived,
        lastMaintainerActivityAt: repo.updatedAt,
        riskFlags: {
          secretsDetected: artifacts.risk_flags.some((f) => f.includes("secret")),
          testsFailed: artifacts.test_results.includes("FAILED"),
        },
      });

      const artifactKeys = {
        diff_key: artifacts.diff,
        trace_key: artifacts.execution_trace,
        summary_key: artifacts.summary,
        test_results_key: artifacts.test_results,
      };

      if (!gateResult.passed) {
        let failureReason = gateResult.reason ?? "Failed quality gates";

        if (
          artifacts.confidence_score === 0 &&
          artifacts.risk_flags.some((f) => f.includes("execution_error") || f.includes("Error"))
        ) {
          const detailFlag = artifacts.risk_flags.find((f) => !f.startsWith("execution_error"));
          failureReason = detailFlag
            ? `LLM call failed: ${detailFlag}`
            : artifacts.summary || failureReason;
        }

        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: "failed",
            confidenceScore: artifacts.confidence_score,
            diffLinesChanged: artifacts.changed_files.length,
            artifactKeys,
            riskFlags: {
              failureReason,
              gateFailure: gateResult.reason ?? "Failed quality gates",
            },
          },
        });
        return;
      }

      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: "review_pending",
          confidenceScore: artifacts.confidence_score,
          diffLinesChanged: artifacts.changed_files.length,
          artifactKeys,
        },
      });

      await prisma.review.create({
        data: {
          jobId,
          userId: dbJob.userId,
          screen1State: "not_started",
        },
      });
    },
    {
      connection: {
        host: redisUrl.hostname,
        port: redisUrl.port ? parseInt(redisUrl.port, 10) : 6379,
        ...(redisUrl.password && { password: redisUrl.password }),
        ...(redisUrl.username && { username: redisUrl.username }),
      },
      concurrency: 5,
    }
  );

  worker.on("failed", (job, err) => {
    const env = getEnv();
    const level = env.NODE_ENV === "production" ? "error" : "warn";
    const payload = {
      level,
      msg: "BullMQ job failed",
      jobId: job?.data?.jobId ?? job?.id,
      error: err.message,
      timestamp: new Date().toISOString(),
    };
    process.stderr.write(JSON.stringify(payload) + "\n");
  });
}

/** Stops the queue worker for graceful shutdown. */
export async function stopWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
}

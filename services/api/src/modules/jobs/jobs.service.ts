import { prisma } from "../../lib/prisma.js";
import { getEnv } from "../../common/config/env.js";
import { dispatchJob } from "./queue.orchestrator.js";
import { getAgentQueue } from "../../lib/queue.js";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Result } from "../../common/types/result.js";
import { ok, err } from "../../common/types/result.js";
import {
  notFound,
  forbidden,
  creditInsufficient,
  validationError,
} from "../../common/errors/app-error.js";
import type {
  JobStatus,
  FamiliarityLevel,
  FixIntent,
  LlmProvider,
} from "@prisma/client";
import { validateProviderModel } from "../ai/provider-catalog.js";
import { resolveProviderModel } from "../ai/llm.gateway.js";

export interface CreateJobInput {
  issueId: string;
  familiarityLevel: FamiliarityLevel;
  fixIntent: FixIntent;
  freeContext?: string;
  llmProvider?: LlmProvider;
  llmModel?: string;
  llmProviderOverride?: string;
}

export interface JobStatusResult {
  id: string;
  status: JobStatus;
  confidenceScore: number | null;
  diffLinesChanged: number | null;
  createdAt: Date;
  failureReason: string | null;
  diff: string | null;
  summary: string | null;
  executionTrace: string | null;
  reviewId: string | null;
}

export interface ArtifactRef {
  key: string;
  url?: string;
}

const CREDIT_COST = 1;

function extractFailureReason(riskFlags: unknown): string | null {
  if (!riskFlags || typeof riskFlags !== "object" || Array.isArray(riskFlags)) {
    return null;
  }
  const flags = riskFlags as Record<string, unknown>;
  if (typeof flags.failureReason === "string" && flags.failureReason.trim()) {
    return flags.failureReason;
  }
  if (typeof flags.gateFailure === "string" && flags.gateFailure.trim()) {
    return flags.gateFailure;
  }
  return null;
}

/**
 * Create a job run for a claimed issue.
 */
export async function createJob(
  userId: string,
  input: CreateJobInput
): Promise<Result<{ jobId: string; status: JobStatus }>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });
  if (!user) return err(notFound("User not found"));

  if (user.creditBalance < CREDIT_COST) {
    return err(creditInsufficient());
  }

  const issue = await prisma.issue.findUnique({
    where: { id: input.issueId },
    include: { repository: true },
  });
  if (!issue) return err(notFound("Issue not found"));
  if (issue.claimedByUserId !== userId) {
    return err(forbidden("Issue not claimed by you"));
  }
  if (issue.claimStatus !== "claimed") {
    return err(validationError("Issue must be claimed"));
  }

  const resolved = await resolveProviderModel(
    input.llmProvider,
    input.llmModel,
    userId,
    input.llmProviderOverride
  );

  const llmProvider = resolved.provider;
  const llmModel = resolved.model;
  const llmProviderOverride = resolved.agentOverride ?? resolved.customOverride ?? input.llmProviderOverride ?? null;

  if (!llmProviderOverride) {
    const catalogCheck = validateProviderModel(llmProvider, llmModel);
    if (!catalogCheck.valid) {
      return err(validationError(catalogCheck.reason ?? "Invalid LLM provider/model"));
    }
  }

  let job: Awaited<ReturnType<typeof prisma.job.create>>;

  try {
    job = await prisma.$transaction(async (tx) => {
      const created = await tx.job.create({
        data: {
          userId,
          issueId: input.issueId,
          status: "queued",
          familiarityLevel: input.familiarityLevel,
          fixIntent: input.fixIntent,
          freeContext: input.freeContext,
          llmProvider,
          llmModel,
          llmProviderOverride,
        },
      });

      await tx.creditTransaction.create({
        data: {
          userId,
          transactionType: "job_run",
          amount: -CREDIT_COST,
          balanceAfter: user.creditBalance - CREDIT_COST,
          referenceId: created.id,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: { creditBalance: user.creditBalance - CREDIT_COST },
      });

      return created;
    });
  } catch (e) {
    return err(validationError("Failed to create job"));
  }

  try {
    await dispatchJob(job.id, input.issueId, llmProvider, llmModel, llmProviderOverride);
  } catch (e) {
    const failureReason =
      e instanceof Error ? e.message : "Failed to dispatch job to worker";
    await prisma.$transaction([
      prisma.creditTransaction.create({
        data: {
          userId,
          transactionType: "refund",
          amount: CREDIT_COST,
          balanceAfter: user.creditBalance,
          referenceId: job.id,
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { creditBalance: user.creditBalance },
      }),
      prisma.job.update({
        where: { id: job.id },
        data: {
          status: "failed",
          riskFlags: { failureReason },
        },
      }),
    ]);
    return err(validationError(`Failed to queue job: ${failureReason}`));
  }

  return ok({ jobId: job.id, status: "queued" as const });
}

/**
 * List jobs for the authenticated user.
 */
export async function listJobs(
  userId: string,
  limit = 20
): Promise<Result<JobStatusResult[]>> {
  const jobs = await prisma.job.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { review: { select: { id: true, screen2PrType: true } } },
  });

  return ok(
    jobs.map((j) => {
      const artifacts = j.artifactKeys as Record<string, string> | null;
      return {
        id: j.id,
        status: j.status,
        confidenceScore: j.confidenceScore,
        diffLinesChanged: j.diffLinesChanged,
        createdAt: j.createdAt,
        failureReason: extractFailureReason(j.riskFlags),
        diff: artifacts?.diff_key ?? null,
        summary: artifacts?.summary_key ?? null,
        executionTrace: artifacts?.trace_key ?? null,
        reviewId: j.review?.id ?? null,
        reviewPrType: j.review?.screen2PrType ?? null,
      };
    })
  );
}

/**
 * Get job status and metadata.
 */
export async function getJob(
  userId: string,
  jobId: string
): Promise<Result<JobStatusResult>> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { review: { select: { id: true } } },
  });
  if (!job) return err(notFound("Job not found"));
  if (job.userId !== userId) return err(forbidden("Not your job"));

  const artifacts = job.artifactKeys as Record<string, string> | null;

  return ok({
    id: job.id,
    status: job.status,
    confidenceScore: job.confidenceScore,
    diffLinesChanged: job.diffLinesChanged,
    createdAt: job.createdAt,
    failureReason: extractFailureReason(job.riskFlags),
    diff: artifacts?.diff_key ?? null,
    summary: artifacts?.summary_key ?? null,
    executionTrace: artifacts?.trace_key ?? null,
    reviewId: job.review?.id ?? null,
  });
}

/**
 * Get job artifact references.
 */
export async function getJobArtifacts(
  userId: string,
  jobId: string
): Promise<Result<ArtifactRef[]>> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
  });
  if (!job) return err(notFound("Job not found"));
  if (job.userId !== userId) return err(forbidden("Not your job"));

  const keys = job.artifactKeys as Record<string, string> | null;
  if (!keys) return ok([]);

  const refs: ArtifactRef[] = Object.keys(keys).map((k) => ({ key: k }));
  return ok(refs);
}

/**
 * Get presigned URL for a specific artifact.
 */
export async function getArtifactPresignedUrl(
  userId: string,
  jobId: string,
  key: string
): Promise<Result<string>> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
  });
  if (!job) return err(notFound("Job not found"));
  if (job.userId !== userId) return err(forbidden("Not your job"));

  const keys = job.artifactKeys as Record<string, string> | null;
  const s3Key = keys?.[key];
  if (!s3Key) return err(notFound("Artifact not found"));

  const env = getEnv();
  const client = new S3Client({ region: env.S3_REGION });
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: s3Key,
    }),
    { expiresIn: 900 }
  );

  return ok(url);
}

/**
 * Regenerate fix package (costs 1 credit). Allowed only for owner when job is review_pending.
 */
export async function regenerateJob(
  userId: string,
  jobId: string
): Promise<Result<{ jobId: string; status: JobStatus }>> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { user: true },
  });
  if (!job) return err(notFound("Job not found"));
  if (job.userId !== userId) return err(forbidden("Not your job"));

  if (job.status !== "review_pending" && job.status !== "rejected") {
    return err(validationError("Job must be review_pending or rejected"));
  }

  if (job.user.creditBalance < CREDIT_COST) {
    return err(creditInsufficient());
  }

  await prisma.creditTransaction.create({
    data: {
      userId,
      transactionType: "regeneration",
      amount: -CREDIT_COST,
      balanceAfter: job.user.creditBalance - CREDIT_COST,
      referenceId: jobId,
    },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { creditBalance: job.user.creditBalance - CREDIT_COST },
  });

  await prisma.job.update({
    where: { id: jobId },
    data: { status: "queued" },
  });

  const queue = getAgentQueue();
  await queue.add("run", { jobId: job.id, issueId: job.issueId });

  return ok({ jobId: job.id, status: "queued" });
}

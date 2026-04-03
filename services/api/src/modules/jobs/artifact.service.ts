/**
 * Artifact service — manages job artifact storage and retrieval via S3.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "../../common/config/env.js";
import type { Result } from "../../common/types/result.js";
import { ok, err } from "../../common/types/result.js";
import { notFound } from "../../common/errors/app-error.js";

const PRESIGN_TTL_SECONDS = 900;

function getS3Client(): S3Client {
  const env = getEnv();
  return new S3Client({ region: env.S3_REGION });
}

/** Upload an artifact to S3. */
export async function uploadArtifact(
  jobId: string,
  artifactName: string,
  content: string | Buffer,
  contentType = "application/octet-stream"
): Promise<Result<{ key: string }>> {
  const env = getEnv();
  const key = `jobs/${jobId}/${artifactName}`;

  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: typeof content === "string" ? Buffer.from(content, "utf-8") : content,
      ContentType: contentType,
    })
  );

  return ok({ key });
}

/** Get a presigned URL for downloading an artifact. */
export async function getArtifactUrl(
  jobId: string,
  artifactName: string
): Promise<Result<string>> {
  const env = getEnv();
  const key = `jobs/${jobId}/${artifactName}`;

  const client = getS3Client();

  try {
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
      }),
      { expiresIn: PRESIGN_TTL_SECONDS }
    );
    return ok(url);
  } catch {
    return err(notFound("Artifact not found"));
  }
}

/** Delete all artifacts for a job. */
export async function deleteJobArtifacts(
  _jobId: string,
  artifactKeys: string[]
): Promise<void> {
  const env = getEnv();
  const client = getS3Client();

  await Promise.allSettled(
    artifactKeys.map((key) =>
      client.send(
        new DeleteObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: key,
        })
      )
    )
  );
}

/** Upload all artifacts from a worker callback payload. */
export async function uploadJobArtifacts(
  jobId: string,
  artifacts: {
    diff: string;
    executionTrace: string;
    summary: string;
    testResults: string;
  }
): Promise<Record<string, string>> {
  const keys: Record<string, string> = {};

  if (artifacts.diff) {
    const result = await uploadArtifact(jobId, "diff.patch", artifacts.diff, "text/plain");
    if (result.ok) keys.diff_key = result.data.key;
  }

  if (artifacts.executionTrace) {
    const result = await uploadArtifact(jobId, "trace.log", artifacts.executionTrace, "text/plain");
    if (result.ok) keys.trace_key = result.data.key;
  }

  if (artifacts.summary) {
    const result = await uploadArtifact(jobId, "summary.md", artifacts.summary, "text/markdown");
    if (result.ok) keys.summary_key = result.data.key;
  }

  if (artifacts.testResults) {
    const result = await uploadArtifact(jobId, "tests.log", artifacts.testResults, "text/plain");
    if (result.ok) keys.test_key = result.data.key;
  }

  return keys;
}

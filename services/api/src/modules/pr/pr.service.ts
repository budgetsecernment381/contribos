import { Octokit } from "@octokit/rest";
import { prisma } from "../../lib/prisma.js";
import type { Result } from "../../common/types/result.js";
import { ok, err } from "../../common/types/result.js";
import {
  notFound,
  forbidden,
  validationError,
  internalError,
} from "../../common/errors/app-error.js";
import type { PrState, PrType } from "@prisma/client";
import pino from "pino";

const logger = pino({ name: "pr" });

export interface CreatePRInput {
  reviewId: string;
  idempotencyKey: string;
  disclosureText?: string;
  prType?: "draft" | "ready_for_review";
  commitStyle?: "conventional" | "imperative";
}

export interface PRListItem {
  id: string;
  githubPrUrl: string | null;
  state: PrState;
  createdAt: Date;
}

/**
 * Create PR from approved review. Idempotent via idempotency_key.
 * Forks the repo (if needed), creates a branch, pushes the diff as a commit,
 * and opens a pull request on the upstream repo.
 */
export async function createPR(
  userId: string,
  input: CreatePRInput
): Promise<
  Result<{
    id: string;
    githubPrId: number | null;
    githubPrUrl: string | null;
    state: PrState;
  }>
> {
  const review = await prisma.review.findUnique({
    where: { id: input.reviewId },
    include: { job: { include: { issue: { include: { repository: true } } } } },
  });
  if (!review) return err(notFound("Review not found"));
  if (review.userId !== userId) return err(forbidden("Not your review"));

  if (!review.approvalTimestamp) {
    return err(validationError("Review must be approved first"));
  }

  const existing = await prisma.pullRequest.findFirst({
    where: { userId, idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    return ok({
      id: existing.id,
      githubPrId: existing.githubPrId,
      githubPrUrl: existing.githubPrUrl,
      state: existing.state,
    });
  }

  const job = review.job;

  const existingForJob = await prisma.pullRequest.findUnique({
    where: { jobId: job.id },
  });
  if (existingForJob) {
    if (existingForJob.githubPrUrl) {
      return ok({
        id: existingForJob.id,
        githubPrId: existingForJob.githubPrId,
        githubPrUrl: existingForJob.githubPrUrl,
        state: existingForJob.state,
      });
    }
    await prisma.pullRequest.delete({ where: { id: existingForJob.id } });
  }
  const issue = job.issue;
  const repo = issue.repository;
  const artifacts = job.artifactKeys as Record<string, string> | null;
  const diff = artifacts?.diff_key ?? "";

  if (!diff.trim()) {
    return err(validationError("No diff available to submit"));
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { githubAccessToken: true, githubUsername: true },
  });

  if (!user?.githubAccessToken) {
    return err(validationError("GitHub token not found. Please log out and log back in to re-authorize."));
  }

  const octokit = new Octokit({ auth: user.githubAccessToken });
  const [upstreamOwner, upstreamRepo] = repo.fullName.split("/");

  let githubPrId: number | null = null;
  let githubPrUrl: string | null = null;

  try {
    let forkOwner = user.githubUsername;
    try {
      await octokit.rest.repos.get({ owner: forkOwner, repo: upstreamRepo });
    } catch {
      await octokit.rest.repos.createFork({ owner: upstreamOwner, repo: upstreamRepo });
      await new Promise((r) => setTimeout(r, 3000));
    }

    const { data: defaultBranchData } = await octokit.rest.repos.get({
      owner: upstreamOwner,
      repo: upstreamRepo,
    });
    const defaultBranch = defaultBranchData.default_branch;

    const { data: refData } = await octokit.rest.git.getRef({
      owner: forkOwner,
      repo: upstreamRepo,
      ref: `heads/${defaultBranch}`,
    });
    const baseSha = refData.object.sha;

    const branchName = `contribos/fix-${issue.githubIssueId}-${Date.now()}`;
    await octokit.rest.git.createRef({
      owner: forkOwner,
      repo: upstreamRepo,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });

    const changedFiles = parseDiffFiles(diff);

    if (changedFiles.length === 0) {
      return err(validationError("Could not parse any file changes from the diff"));
    }

    const { data: baseCommit } = await octokit.rest.git.getCommit({
      owner: forkOwner,
      repo: upstreamRepo,
      commit_sha: baseSha,
    });

    const treeEntries = [];
    for (const file of changedFiles) {
      if (file.deleted) {
        treeEntries.push({
          path: file.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: null,
        });
      } else {
        let newContent: string;
        const hasRealHunks = file.hunks.length > 0 && file.hunks.every(h => h.oldStart >= 0);

        if (hasRealHunks) {
          let originalContent = "";
          try {
            const { data: fileData } = await octokit.rest.repos.getContent({
              owner: forkOwner,
              repo: upstreamRepo,
              path: file.path,
              ref: baseSha,
            });
            if ("content" in fileData && fileData.content) {
              originalContent = Buffer.from(fileData.content, "base64").toString("utf-8");
            }
          } catch {
            // File doesn't exist in base (new file) — use hunk content directly
          }
          newContent = originalContent
            ? applyHunksToContent(originalContent, file.hunks, file.addedLines)
            : file.addedLines.join("\n") + "\n";
        } else {
          newContent = file.addedLines.join("\n") + "\n";
        }

        const { data: blob } = await octokit.rest.git.createBlob({
          owner: forkOwner,
          repo: upstreamRepo,
          content: newContent,
          encoding: "utf-8",
        });
        treeEntries.push({
          path: file.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: blob.sha,
        });
      }
    }

    const { data: newTree } = await octokit.rest.git.createTree({
      owner: forkOwner,
      repo: upstreamRepo,
      base_tree: baseCommit.tree.sha,
      tree: treeEntries,
    });

    const commitPrefix = input.commitStyle === "imperative" ? "Fix" : "fix:";
    const commitMsg = `${commitPrefix} ${issue.title.slice(0, 72)}`;

    const { data: newCommit } = await octokit.rest.git.createCommit({
      owner: forkOwner,
      repo: upstreamRepo,
      message: commitMsg,
      tree: newTree.sha,
      parents: [baseSha],
    });

    await octokit.rest.git.updateRef({
      owner: forkOwner,
      repo: upstreamRepo,
      ref: `heads/${branchName}`,
      sha: newCommit.sha,
    });

    const prTitle = commitMsg;
    const prBody = review.oneLiner
      ? `${review.oneLiner}\n\nCloses #${issue.githubIssueId}`
      : `Closes #${issue.githubIssueId}`;

    const { data: ghPR } = await octokit.rest.pulls.create({
      owner: upstreamOwner,
      repo: upstreamRepo,
      title: prTitle,
      body: prBody,
      head: `${forkOwner}:${branchName}`,
      base: defaultBranch,
      draft: input.prType === "draft",
    });

    githubPrId = ghPR.number;
    githubPrUrl = ghPR.html_url;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("[pr.service] GitHub PR creation failed: %s", msg);
    return err(internalError(`GitHub PR creation failed: ${msg.slice(0, 300)}`));
  }

  const pr = await prisma.pullRequest.create({
    data: {
      jobId: job.id,
      reviewId: review.id,
      userId,
      repoId: repo.id,
      githubRepoFullName: repo.fullName,
      githubPrId,
      githubPrUrl,
      prType: ((input.prType ?? "draft") as PrType),
      disclosureText: input.disclosureText ?? "",
      idempotencyKey: input.idempotencyKey,
      state: "open",
    },
  });

  await prisma.job.update({
    where: { id: job.id },
    data: { status: "submitted" },
  });

  return ok({
    id: pr.id,
    githubPrId: pr.githubPrId,
    githubPrUrl: pr.githubPrUrl,
    state: pr.state,
  });
}

type HunkLine = { type: "context"; text: string } | { type: "add"; text: string } | { type: "remove"; text: string };

interface ParsedHunk {
  oldStart: number;
  oldCount: number;
  lines: HunkLine[];
}

interface ParsedFileDiff {
  path: string;
  deleted: boolean;
  hunks: ParsedHunk[];
  addedLines: string[];
}

/**
 * Split a unified diff into per-file sections.
 * Handles both `diff --git` headers and bare `---`/`+++` headers that LLMs often produce.
 */
function splitDiffSections(diff: string): string[] {
  const hasGitHeaders = /^diff --git /m.test(diff);
  if (hasGitHeaders) {
    return diff.split(/^diff --git /m).filter(Boolean);
  }
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("--- ") && !line.startsWith("--- a/dev/null") && current.length > 0) {
      const hasContent = current.some(l => l.startsWith("@@") || l.startsWith("+") || l.startsWith("-"));
      if (hasContent) {
        sections.push(current.join("\n"));
        current = [line];
        continue;
      }
    }
    current.push(line);
  }
  if (current.length > 0) {
    sections.push(current.join("\n"));
  }
  return sections.filter(Boolean);
}

/**
 * Extract the file path from a `---` or `+++` header line.
 * Handles: `+++ b/path`, `+++ a/path`, `+++ path`, `--- a/path`, `--- path`
 */
function extractPath(line: string): string {
  let p = line.slice(4).trim();
  if (p.startsWith("a/") || p.startsWith("b/")) p = p.slice(2);
  return p;
}

/**
 * Parse a unified diff into individual file changes.
 * Handles multiple diff formats LLMs produce:
 *   - Standard `diff --git a/file b/file` with `--- a/` / `+++ b/` 
 *   - Bare `--- file` / `+++ file` without git headers
 *   - Placeholder hunk headers like `@@ ... @@`
 */
function parseDiffFiles(diff: string): ParsedFileDiff[] {
  const files: ParsedFileDiff[] = [];
  const sections = splitDiffSections(diff);

  for (const section of sections) {
    const lines = section.split("\n");
    let filePath = "";
    let isDeleted = false;

    for (const line of lines) {
      if (line.startsWith("+++ ")) {
        const p = extractPath(line);
        if (p === "/dev/null") {
          isDeleted = true;
        } else if (p) {
          filePath = p;
        }
      } else if (line.startsWith("--- ") && !filePath) {
        const p = extractPath(line);
        if (p && p !== "/dev/null") {
          filePath = p;
        }
      }
    }

    if (!filePath) continue;

    if (isDeleted) {
      files.push({ path: filePath, deleted: true, hunks: [], addedLines: [] });
      continue;
    }

    const hunks: ParsedHunk[] = [];
    const addedLines: string[] = [];
    let inHunk = false;
    let currentHunk: ParsedHunk | null = null;

    for (const line of lines) {
      if (line.startsWith("@@")) {
        inHunk = true;
        const m = line.match(/@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/);
        currentHunk = {
          oldStart: m ? parseInt(m[1], 10) : -1,
          oldCount: m && m[2] !== undefined ? parseInt(m[2], 10) : 1,
          lines: [],
        };
        hunks.push(currentHunk);
        continue;
      }
      if (!inHunk) continue;
      if (line.startsWith("-")) {
        currentHunk?.lines.push({ type: "remove", text: line.slice(1) });
      } else if (line.startsWith("+")) {
        currentHunk?.lines.push({ type: "add", text: line.slice(1) });
        addedLines.push(line.slice(1));
      } else if (line.startsWith(" ")) {
        currentHunk?.lines.push({ type: "context", text: line.slice(1) });
        addedLines.push(line.slice(1));
      } else if (line.startsWith("\\")) {
        continue;
      }
    }

    if (addedLines.length > 0 || hunks.length > 0) {
      files.push({ path: filePath, deleted: false, hunks, addedLines });
    }
  }

  return files;
}

/**
 * Apply parsed diff hunks against original file content to produce the new file.
 * Falls back to hunk-only content if hunk metadata is insufficient.
 */
function applyHunksToContent(original: string, hunks: ParsedHunk[], fallbackLines: string[]): string {
  if (hunks.length === 0 || hunks.some(h => h.oldStart < 0)) {
    return fallbackLines.join("\n") + "\n";
  }

  const origLines = original.split("\n");
  const result: string[] = [];
  let origIdx = 0;

  for (const hunk of hunks) {
    const hunkStart = hunk.oldStart - 1;
    while (origIdx < hunkStart && origIdx < origLines.length) {
      result.push(origLines[origIdx]);
      origIdx++;
    }
    for (const hl of hunk.lines) {
      if (hl.type === "context") {
        result.push(hl.text);
        origIdx++;
      } else if (hl.type === "add") {
        result.push(hl.text);
      } else if (hl.type === "remove") {
        origIdx++;
      }
    }
  }

  while (origIdx < origLines.length) {
    result.push(origLines[origIdx]);
    origIdx++;
  }

  return result.join("\n");
}

export async function listPRs(
  userId: string,
  state?: PrState,
  limit = 20
): Promise<Result<PRListItem[]>> {
  const prs = await prisma.pullRequest.findMany({
    where: {
      userId,
      ...(state && { state }),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return ok(
    prs.map((p) => ({
      id: p.id,
      githubPrUrl: p.githubPrUrl,
      state: p.state,
      createdAt: p.createdAt,
    }))
  );
}

export async function getPR(
  userId: string,
  prId: string
): Promise<
  Result<{
    id: string;
    githubPrId: number | null;
    githubPrUrl: string | null;
    state: PrState;
    prType: string;
    maintainerCommentsCount: number;
    changesRequested: boolean;
    createdAt: Date;
  }>
> {
  const pr = await prisma.pullRequest.findUnique({
    where: { id: prId },
  });
  if (!pr) return err(notFound("PR not found"));
  if (pr.userId !== userId) return err(forbidden("Not your PR"));

  return ok({
    id: pr.id,
    githubPrId: pr.githubPrId,
    githubPrUrl: pr.githubPrUrl,
    state: pr.state,
    prType: pr.prType,
    maintainerCommentsCount: pr.maintainerCommentsCount,
    changesRequested: pr.changesRequested,
    createdAt: pr.createdAt,
  });
}

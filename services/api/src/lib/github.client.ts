import { Octokit } from "@octokit/rest";
import { getEnv } from "../common/config/env.js";
import { ok, err } from "../common/types/result.js";
import type { Result } from "../common/types/result.js";
import {
  notFound,
  forbidden,
  internalError,
} from "../common/errors/app-error.js";

export interface GitHubIssueData {
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  html_url: string;
  state: "open" | "closed";
  created_at: string;
  updated_at: string;
}

export interface FetchIssuesResult {
  issues: GitHubIssueData[];
  etag: string | null;
  rateLimitRemaining: number;
}

export interface GitHubRepoData {
  id: number;
  full_name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  topics: string[];
  stargazers_count: number;
  archived: boolean;
  fork: boolean;
  open_issues_count: number;
}

let cachedClient: Octokit | null = null;

export function createGitHubClient(): Octokit {
  if (cachedClient) return cachedClient;
  const env = getEnv();
  cachedClient = new Octokit({
    auth: env.GITHUB_PAT || undefined,
  });
  return cachedClient;
}

/**
 * Fetch open issues for a repository. Returns null on 304 (ETag match).
 * Paginates up to maxPages (default 10 = 1000 issues).
 */
export async function fetchRepoIssues(
  client: Octokit,
  owner: string,
  repo: string,
  etag?: string | null,
  maxPages = 10
): Promise<Result<FetchIssuesResult | null>> {
  try {
    const allIssues: GitHubIssueData[] = [];
    let currentEtag: string | null = null;
    let rateLimitRemaining = 5000;

    for (let page = 1; page <= maxPages; page++) {
      const headers: Record<string, string> = {};
      if (page === 1 && etag) {
        headers["if-none-match"] = etag;
      }

      let response;
      try {
        response = await client.rest.issues.listForRepo({
          owner,
          repo,
          state: "open",
          per_page: 100,
          page,
          headers,
        });
      } catch (e: unknown) {
        if (isOctokitError(e) && e.status === 304) {
          return ok(null);
        }
        throw e;
      }

      if (page === 1) {
        currentEtag = (response.headers.etag as string) ?? null;
      }
      rateLimitRemaining = parseInt(
        (response.headers["x-ratelimit-remaining"] as string) ?? "5000",
        10
      );

      const issues = response.data
        .filter((item) => !("pull_request" in item && item.pull_request))
        .map((item) => ({
          number: item.number,
          title: item.title,
          body: item.body ?? null,
          labels: item.labels
            .map((l) => (typeof l === "string" ? l : l.name ?? ""))
            .filter(Boolean),
          html_url: item.html_url,
          state: item.state as "open" | "closed",
          created_at: item.created_at,
          updated_at: item.updated_at,
        }));

      allIssues.push(...issues);

      if (response.data.length < 100) break;

      if (rateLimitRemaining < 100) {
        console.warn(
          `[github-client] Rate limit low (${rateLimitRemaining}), stopping pagination for ${owner}/${repo}`
        );
        break;
      }
    }

    return ok({ issues: allIssues, etag: currentEtag, rateLimitRemaining });
  } catch (e: unknown) {
    if (isOctokitError(e)) {
      if (e.status === 404) {
        return err(notFound(`Repository ${owner}/${repo} not found on GitHub`));
      }
      if (e.status === 403) {
        return err(forbidden(`GitHub rate limit exceeded for ${owner}/${repo}`));
      }
      return err(internalError(`GitHub API error: ${e.message}`));
    }
    return err(internalError(`GitHub request failed: ${String(e)}`));
  }
}

export async function fetchRepoMetadata(
  client: Octokit,
  owner: string,
  repo: string
): Promise<Result<GitHubRepoData>> {
  try {
    const response = await client.rest.repos.get({ owner, repo });
    return ok({
      id: response.data.id,
      full_name: response.data.full_name,
      description: response.data.description,
      html_url: response.data.html_url,
      language: response.data.language,
      topics: response.data.topics ?? [],
      stargazers_count: response.data.stargazers_count,
      archived: response.data.archived,
      fork: response.data.fork,
      open_issues_count: response.data.open_issues_count,
    });
  } catch (e: unknown) {
    if (isOctokitError(e) && e.status === 404) {
      return err(notFound(`Repository ${owner}/${repo} not found on GitHub`));
    }
    return err(internalError(`GitHub API error: ${String(e)}`));
  }
}

export async function searchRepositories(
  client: Octokit,
  query: string,
  page = 1,
  perPage = 30
): Promise<Result<GitHubRepoData[]>> {
  try {
    const response = await client.rest.search.repos({
      q: query,
      sort: "stars",
      order: "desc",
      per_page: perPage,
      page,
    });

    const repos: GitHubRepoData[] = response.data.items.map((item) => ({
      id: item.id,
      full_name: item.full_name,
      description: item.description ?? null,
      html_url: item.html_url,
      language: item.language ?? null,
      topics: item.topics ?? [],
      stargazers_count: item.stargazers_count ?? 0,
      archived: item.archived ?? false,
      fork: item.fork,
      open_issues_count: item.open_issues_count ?? 0,
    }));

    return ok(repos);
  } catch (e: unknown) {
    return err(internalError(`GitHub search failed: ${String(e)}`));
  }
}

function isOctokitError(e: unknown): e is { status: number; message: string } {
  return (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    typeof (e as { status: unknown }).status === "number"
  );
}

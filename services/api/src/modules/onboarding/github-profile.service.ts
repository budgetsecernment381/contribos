/**
 * GitHub profile service — fetches contributor signals from GitHub API
 * for tier calibration. Replaces hardcoded placeholder signals.
 */

import type { GitHubSignals } from "./tiering.engine.js";

interface GitHubUser {
  login: string;
  id: number;
  created_at: string;
  public_repos: number;
}

interface GitHubRepo {
  language: string | null;
  stargazers_count: number;
  fork: boolean;
}

const GITHUB_API = "https://api.github.com";

/** Fetch GitHub signals for a user by their username. */
export async function fetchGitHubSignals(
  githubUsername: string,
  githubToken?: string
): Promise<GitHubSignals> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "ContribOS/0.1",
  };
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  try {
    const [userRes, eventsRes, reposRes] = await Promise.all([
      fetch(`${GITHUB_API}/users/${githubUsername}`, { headers }),
      fetch(`${GITHUB_API}/users/${githubUsername}/events/public?per_page=100`, { headers }),
      fetch(`${GITHUB_API}/users/${githubUsername}/repos?per_page=100&sort=pushed`, { headers }),
    ]);

    if (!userRes.ok) {
      return fallbackSignals();
    }
    const user = (await userRes.json()) as GitHubUser;

    const accountAgeMonths = Math.floor(
      (Date.now() - new Date(user.created_at).getTime()) / (30.44 * 24 * 60 * 60 * 1000)
    );

    let contributionCountLastYear = 0;
    if (eventsRes.ok) {
      const events = (await eventsRes.json()) as Array<{
        type: string;
        created_at: string;
      }>;
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      contributionCountLastYear = events.filter(
        (e) =>
          new Date(e.created_at) > oneYearAgo &&
          [
            "PushEvent",
            "PullRequestEvent",
            "IssuesEvent",
            "PullRequestReviewEvent",
          ].includes(e.type)
      ).length;
    }

    let languagesWithContributions = 0;
    let maxStarsOnContributedRepo = 0;
    if (reposRes.ok) {
      const repos = (await reposRes.json()) as GitHubRepo[];
      const languages = new Set<string>();
      for (const repo of repos) {
        if (repo.language) languages.add(repo.language);
        if (!repo.fork && repo.stargazers_count > maxStarsOnContributedRepo) {
          maxStarsOnContributedRepo = repo.stargazers_count;
        }
      }
      languagesWithContributions = languages.size;
    }

    return {
      accountAgeMonths,
      publicRepoCount: user.public_repos,
      contributionCountLastYear,
      languagesWithContributions,
      maxStarsOnContributedRepo,
    };
  } catch {
    return fallbackSignals();
  }
}

function fallbackSignals(): GitHubSignals {
  return {
    accountAgeMonths: 12,
    publicRepoCount: 5,
    contributionCountLastYear: 10,
    languagesWithContributions: 2,
    maxStarsOnContributedRepo: 500,
  };
}

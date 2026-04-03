import { prisma } from "../../lib/prisma.js";
import { createGitHubClient, searchRepositories } from "../../lib/github.client.js";
import { ok } from "../../common/types/result.js";
import type { Result } from "../../common/types/result.js";
import { getEnv } from "../../common/config/env.js";
import { computePrestigeTier } from "../matching/scoring.engine.js";
import pino from "pino";

const logger = pino({ name: "repo-finder" });

export interface DiscoveryConfig {
  ecosystemQueries: string[];
  minStars: number;
  maxResultsPerQuery: number;
}

export interface DiscoveryResult {
  totalDiscovered: number;
  newReposInserted: number;
  skippedExisting: number;
}

const DEFAULT_ECOSYSTEM_QUERIES = [
  "topic:react language:typescript stars:>100 is:public",
  "topic:nextjs language:typescript stars:>100 is:public",
  "topic:nodejs language:javascript stars:>200 is:public",
  "topic:python language:python stars:>200 is:public",
  "topic:rust language:rust stars:>100 is:public",
  "topic:go language:go stars:>200 is:public",
];

const DEFAULT_CONFIG: DiscoveryConfig = {
  ecosystemQueries: DEFAULT_ECOSYSTEM_QUERIES,
  minStars: 100,
  maxResultsPerQuery: 30,
};

function inferEcosystem(language: string | null, topics: string[]): string {
  if (language) {
    const langMap: Record<string, string> = {
      TypeScript: "typescript",
      JavaScript: "javascript",
      Python: "python",
      Rust: "rust",
      Go: "go",
      Java: "java",
      Ruby: "ruby",
      PHP: "php",
      "C#": "dotnet",
      Swift: "swift",
      Kotlin: "kotlin",
    };
    if (langMap[language]) return langMap[language];
  }

  const topicMap: Record<string, string> = {
    react: "typescript",
    nextjs: "typescript",
    vue: "javascript",
    angular: "typescript",
    nodejs: "javascript",
    deno: "typescript",
    django: "python",
    flask: "python",
    fastapi: "python",
    rails: "ruby",
    spring: "java",
  };

  for (const topic of topics) {
    if (topicMap[topic]) return topicMap[topic];
  }

  return language?.toLowerCase() ?? "other";
}

export async function discoverRepositories(
  config?: Partial<DiscoveryConfig>
): Promise<Result<DiscoveryResult>> {
  const env = getEnv();
  if (!env.GITHUB_PAT) {
    logger.info("[repo-finder] GITHUB_PAT not set, skipping discovery");
    return ok({ totalDiscovered: 0, newReposInserted: 0, skippedExisting: 0 });
  }

  const cfg = { ...DEFAULT_CONFIG, ...config };
  const client = createGitHubClient();

  let totalDiscovered = 0;
  let newReposInserted = 0;
  let skippedExisting = 0;

  for (const query of cfg.ecosystemQueries) {
    const searchResult = await searchRepositories(
      client,
      query,
      1,
      cfg.maxResultsPerQuery
    );

    if (!searchResult.ok) {
      logger.error(
        `[repo-finder] Search failed for query "${query}": ${searchResult.error.message}`
      );
      continue;
    }

    for (const ghRepo of searchResult.data) {
      if (ghRepo.archived || ghRepo.fork) continue;
      if (ghRepo.stargazers_count < cfg.minStars) continue;
      if (ghRepo.open_issues_count === 0) continue;

      totalDiscovered++;

      const existing = await prisma.repository.findUnique({
        where: { fullName: ghRepo.full_name },
      });

      if (existing) {
        skippedExisting++;
        continue;
      }

      try {
        const autoPrestige = computePrestigeTier(
          ghRepo.stargazers_count,
          ghRepo.open_issues_count,
          false,
        );
        await prisma.repository.create({
          data: {
            githubRepoId: ghRepo.id,
            fullName: ghRepo.full_name,
            description: ghRepo.description,
            htmlUrl: ghRepo.html_url,
            language: ghRepo.language,
            topics: ghRepo.topics,
            ecosystem: inferEcosystem(ghRepo.language, ghRepo.topics),
            starCount: ghRepo.stargazers_count,
            prestigeTier: autoPrestige,
            allowlistState: "pending",
          },
        });
        newReposInserted++;
      } catch (e: unknown) {
        if (
          typeof e === "object" &&
          e !== null &&
          "code" in e &&
          (e as { code: string }).code === "P2002"
        ) {
          skippedExisting++;
        } else {
          logger.error(
            `[repo-finder] Failed to insert ${ghRepo.full_name}: ${String(e)}`
          );
        }
      }
    }
  }

  logger.info(
    `[repo-finder] Discovery complete: discovered=${totalDiscovered} inserted=${newReposInserted} skipped=${skippedExisting}`
  );

  return ok({ totalDiscovered, newReposInserted, skippedExisting });
}

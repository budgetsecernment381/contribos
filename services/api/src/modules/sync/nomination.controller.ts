import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import {
  createGitHubClient,
  fetchRepoMetadata,
} from "../../lib/github.client.js";

const nominateSchema = z.object({
  repoUrl: z.string().url("Must be a valid URL"),
});

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return null;
    const parts = parsed.pathname.replace(/^\//, "").replace(/\/$/, "").split("/");
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

function inferEcosystem(language: string | null, topics: string[]): string {
  if (language) {
    const langMap: Record<string, string> = {
      TypeScript: "typescript",
      JavaScript: "javascript",
      Python: "python",
      Rust: "rust",
      Go: "go",
      Java: "java",
    };
    if (langMap[language]) return langMap[language];
  }
  for (const topic of topics) {
    const topicMap: Record<string, string> = {
      react: "typescript",
      nextjs: "typescript",
      vue: "javascript",
      nodejs: "javascript",
      django: "python",
    };
    if (topicMap[topic]) return topicMap[topic];
  }
  return language?.toLowerCase() ?? "other";
}

export async function registerNominationRoutes(
  fastify: FastifyInstance
): Promise<void> {
  fastify.post(
    "/nominate",
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = nominateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: parsed.error.flatten(),
        });
      }

      const ghParts = parseGitHubUrl(parsed.data.repoUrl);
      if (!ghParts) {
        return reply.status(400).send({
          code: "VALIDATION_ERROR",
          message: "URL must be a valid GitHub repository URL (https://github.com/owner/repo)",
        });
      }

      const fullName = `${ghParts.owner}/${ghParts.repo}`;
      const existing = await prisma.repository.findUnique({
        where: { fullName },
      });
      if (existing) {
        return reply.status(409).send({
          code: "CONFLICT",
          message: `Repository ${fullName} already exists`,
        });
      }

      const client = createGitHubClient();
      const metaResult = await fetchRepoMetadata(
        client,
        ghParts.owner,
        ghParts.repo
      );

      if (!metaResult.ok) {
        const status = metaResult.error.code === "NOT_FOUND" ? 404 : 500;
        return reply
          .status(status)
          .send(metaResult.error.toJSON());
      }

      const ghRepo = metaResult.data;
      const userId = (req.user as { id: string }).id;

      const repo = await prisma.repository.create({
        data: {
          githubRepoId: ghRepo.id,
          fullName: ghRepo.full_name,
          description: ghRepo.description,
          htmlUrl: ghRepo.html_url,
          language: ghRepo.language,
          topics: ghRepo.topics,
          ecosystem: inferEcosystem(ghRepo.language, ghRepo.topics),
          starCount: ghRepo.stargazers_count,
          allowlistState: "pending",
          nominatedByUserId: userId,
        },
      });

      return reply.status(201).send({ repository: repo });
    }
  );
}

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Deterministic, idempotent seed for ContribOS.
 * Creates: 1 admin, 1 contributor, 3 repos (TypeScript, Python, Go), 5 issues per repo.
 */
async function main() {
  await prisma.user.upsert({
    where: { githubId: 1 },
    create: {
      githubId: 1,
      githubUsername: "admin",
      email: "admin@contribos.example",
      role: "admin",
      tier: 3,
      contributionHealthScore: 85,
      onboardingComplete: true,
      creditBalance: 100,
      planTier: "pro",
    },
    update: {},
  });

  await prisma.user.upsert({
    where: { githubId: 2 },
    create: {
      githubId: 2,
      githubUsername: "contributor",
      email: "contributor@contribos.example",
      role: "contributor",
      tier: 2,
      contributionHealthScore: 62,
      onboardingComplete: true,
      creditBalance: 5,
      planTier: "free",
    },
    update: {},
  });

  const repos = await Promise.all([
    prisma.repository.upsert({
      where: { githubRepoId: 1001 },
      create: {
        githubRepoId: 1001,
        fullName: "example/ts-utils",
        ecosystem: "TypeScript",
        starCount: 1200,
        prestigeTier: "high",
        prestigeScore: 78.5,
        maintainerActivityScore: 82,
        aiPolicy: "allowed",
        aiPolicyConfidence: 0.9,
        allowlistState: "approved",
      },
      update: {},
    }),
    prisma.repository.upsert({
      where: { githubRepoId: 1002 },
      create: {
        githubRepoId: 1002,
        fullName: "example/py-cli",
        ecosystem: "Python",
        starCount: 450,
        prestigeTier: "mid",
        prestigeScore: 55.2,
        maintainerActivityScore: 68,
        aiPolicy: "disclose_required",
        aiPolicyConfidence: 0.7,
        allowlistState: "approved",
      },
      update: {},
    }),
    prisma.repository.upsert({
      where: { githubRepoId: 1003 },
      create: {
        githubRepoId: 1003,
        fullName: "example/go-server",
        ecosystem: "Go",
        starCount: 3200,
        prestigeTier: "prestige",
        prestigeScore: 92,
        maintainerActivityScore: 95,
        aiPolicy: "allowed",
        aiPolicyConfidence: 0.9,
        allowlistState: "approved",
      },
      update: {},
    }),
  ]);

  const issues: Array<{
    repositoryId: string;
    githubIssueId: number;
    title: string;
    complexityEstimate: string;
    minimumTier: number;
    fixabilityScore: number;
    fitScore: number;
    repoHealthScore: number;
    reputationValueScore: number;
    compositeScore: number;
  }> = [];

  for (const repo of repos) {
    const baseHealth = repo.prestigeScore / 100;
    const baseRep = repo.starCount / 5000;
    issues.push(
      {
        repositoryId: repo.id,
        githubIssueId: 101,
        title: "Fix typo in README",
        complexityEstimate: "trivial",
        minimumTier: 1,
        fixabilityScore: 0.95,
        fitScore: 0.9,
        repoHealthScore: baseHealth,
        reputationValueScore: baseRep,
        compositeScore: 0.95 * 0.3 + 0.9 * 0.25 + baseHealth * 0.25 + baseRep * 0.2,
      },
      {
        repositoryId: repo.id,
        githubIssueId: 102,
        title: "Add missing type annotations",
        complexityEstimate: "small",
        minimumTier: 1,
        fixabilityScore: 0.85,
        fitScore: 0.8,
        repoHealthScore: baseHealth,
        reputationValueScore: baseRep,
        compositeScore: 0.85 * 0.3 + 0.8 * 0.25 + baseHealth * 0.25 + baseRep * 0.2,
      },
      {
        repositoryId: repo.id,
        githubIssueId: 103,
        title: "Fix null pointer in error handler",
        complexityEstimate: "medium",
        minimumTier: 2,
        fixabilityScore: 0.7,
        fitScore: 0.75,
        repoHealthScore: baseHealth,
        reputationValueScore: baseRep,
        compositeScore: 0.7 * 0.3 + 0.75 * 0.25 + baseHealth * 0.25 + baseRep * 0.2,
      },
      {
        repositoryId: repo.id,
        githubIssueId: 104,
        title: "Refactor auth module for testability",
        complexityEstimate: "large",
        minimumTier: 2,
        fixabilityScore: 0.55,
        fitScore: 0.6,
        repoHealthScore: baseHealth,
        reputationValueScore: baseRep,
        compositeScore: 0.55 * 0.3 + 0.6 * 0.25 + baseHealth * 0.25 + baseRep * 0.2,
      },
      {
        repositoryId: repo.id,
        githubIssueId: 105,
        title: "Implement new protocol parser",
        complexityEstimate: "x-large",
        minimumTier: 3,
        fixabilityScore: 0.4,
        fitScore: 0.5,
        repoHealthScore: baseHealth,
        reputationValueScore: baseRep,
        compositeScore: 0.4 * 0.3 + 0.5 * 0.25 + baseHealth * 0.25 + baseRep * 0.2,
      }
    );
  }

  for (const issue of issues) {
    await prisma.issue.upsert({
      where: {
        repositoryId_githubIssueId: {
          repositoryId: issue.repositoryId,
          githubIssueId: issue.githubIssueId,
        },
      },
      create: issue,
      update: {
        title: issue.title,
        complexityEstimate: issue.complexityEstimate,
        minimumTier: issue.minimumTier,
        fixabilityScore: issue.fixabilityScore,
        fitScore: issue.fitScore,
        repoHealthScore: issue.repoHealthScore,
        reputationValueScore: issue.reputationValueScore,
        compositeScore: issue.compositeScore,
      },
    });
  }

  console.log("Seed complete: admin, contributor, 3 repos, 15 issues");
}

(async () => {
  try {
    await main();
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();

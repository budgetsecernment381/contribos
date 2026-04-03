/**
 * Agent Provider CRUD service — manages user A2A agent provider registrations.
 * Mirrors the custom-provider.service.ts pattern with agent-specific additions
 * (Agent Card discovery, cached skills, test via A2A task).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { Result } from "../../common/types/result.js";
import { ok, err } from "../../common/types/result.js";
import {
  notFound,
  forbidden,
  validationError,
} from "../../common/errors/app-error.js";
import {
  encryptApiKey,
  decryptApiKey,
  maskApiKey,
} from "../../common/utils/encryption.util.js";
import {
  discoverAgentCard,
  sendTask,
  type AgentCardData,
  type A2AMessage,
} from "./a2a-client.service.js";

const MAX_AGENT_PROVIDERS = 20;

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export interface CreateAgentProviderInput {
  name: string;
  agentCardUrl: string;
  endpoint: string;
  apiKey?: string;
  authScheme?: string;
  cachedSkills?: unknown;
  cachedCapabilities?: unknown;
}

export interface UpdateAgentProviderInput {
  name?: string;
  apiKey?: string;
  authScheme?: string;
}

export interface AgentProviderResponse {
  id: string;
  name: string;
  agentCardUrl: string;
  endpoint: string;
  maskedApiKey: string | null;
  authScheme: string;
  cachedSkills: unknown;
  cachedCapabilities: unknown;
  isDefault: boolean;
  lastDiscoveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DecryptedAgentProvider {
  endpoint: string;
  apiKey: string | null;
  authScheme: string;
  name: string;
  cachedSkills: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toResponse(p: {
  id: string;
  name: string;
  agentCardUrl: string;
  endpoint: string;
  encryptedApiKey: string | null;
  authScheme: string;
  cachedSkills: unknown;
  cachedCapabilities: unknown;
  isDefault: boolean;
  lastDiscoveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AgentProviderResponse {
  let masked: string | null = null;
  if (p.encryptedApiKey) {
    try {
      const plain = decryptApiKey(p.encryptedApiKey);
      masked = maskApiKey(plain);
    } catch {
      masked = "****";
    }
  }
  return {
    id: p.id,
    name: p.name,
    agentCardUrl: p.agentCardUrl,
    endpoint: p.endpoint,
    maskedApiKey: masked,
    authScheme: p.authScheme,
    cachedSkills: p.cachedSkills,
    cachedCapabilities: p.cachedCapabilities,
    isDefault: p.isDefault,
    lastDiscoveredAt: p.lastDiscoveredAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createAgentProvider(
  userId: string,
  input: CreateAgentProviderInput
): Promise<Result<AgentProviderResponse>> {
  const count = await prisma.agentProvider.count({ where: { userId } });
  if (count >= MAX_AGENT_PROVIDERS) {
    return err(
      validationError(`Maximum ${MAX_AGENT_PROVIDERS} agent providers allowed`)
    );
  }

  const duplicate = await prisma.agentProvider.findUnique({
    where: { userId_name: { userId, name: input.name } },
  });
  if (duplicate) {
    return err(validationError("An agent provider with this name already exists"));
  }

  const encrypted = input.apiKey ? encryptApiKey(input.apiKey) : null;

  const provider = await prisma.agentProvider.create({
    data: {
      userId,
      name: input.name,
      agentCardUrl: input.agentCardUrl.replace(/\/+$/, ""),
      endpoint: input.endpoint.replace(/\/+$/, ""),
      encryptedApiKey: encrypted,
      authScheme: input.authScheme ?? "bearer",
      cachedSkills: input.cachedSkills
        ? (input.cachedSkills as Prisma.InputJsonValue)
        : Prisma.DbNull,
      cachedCapabilities: input.cachedCapabilities
        ? (input.cachedCapabilities as Prisma.InputJsonValue)
        : Prisma.DbNull,
      lastDiscoveredAt: new Date(),
    },
  });

  return ok(toResponse(provider));
}

export async function listAgentProviders(
  userId: string
): Promise<Result<AgentProviderResponse[]>> {
  const providers = await prisma.agentProvider.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return ok(providers.map(toResponse));
}

export async function updateAgentProvider(
  userId: string,
  providerId: string,
  input: UpdateAgentProviderInput
): Promise<Result<AgentProviderResponse>> {
  const provider = await prisma.agentProvider.findUnique({
    where: { id: providerId },
  });
  if (!provider) return err(notFound("Agent provider not found"));
  if (provider.userId !== userId) return err(forbidden("Not your provider"));

  if (input.name && input.name !== provider.name) {
    const duplicate = await prisma.agentProvider.findUnique({
      where: { userId_name: { userId, name: input.name } },
    });
    if (duplicate) {
      return err(validationError("An agent provider with this name already exists"));
    }
  }

  const data: Record<string, unknown> = {};
  if (input.name) data.name = input.name;
  if (input.authScheme) data.authScheme = input.authScheme;
  if (input.apiKey) data.encryptedApiKey = encryptApiKey(input.apiKey);

  const updated = await prisma.agentProvider.update({
    where: { id: providerId },
    data,
  });

  return ok(toResponse(updated));
}

export async function deleteAgentProvider(
  userId: string,
  providerId: string
): Promise<Result<void>> {
  const provider = await prisma.agentProvider.findUnique({
    where: { id: providerId },
  });
  if (!provider) return err(notFound("Agent provider not found"));
  if (provider.userId !== userId) return err(forbidden("Not your provider"));

  const activeJobCount = await prisma.job.count({
    where: {
      userId,
      llmProviderOverride: `agent:${providerId}`,
      status: { in: ["queued", "running"] },
    },
  });
  if (activeJobCount > 0) {
    return err(
      validationError(
        `Cannot delete: ${activeJobCount} active job(s) using this provider`
      )
    );
  }

  await prisma.agentProvider.delete({ where: { id: providerId } });
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Discovery & Test
// ---------------------------------------------------------------------------

export async function discoverAgent(
  userId: string,
  providerId: string
): Promise<Result<AgentProviderResponse>> {
  const provider = await prisma.agentProvider.findUnique({
    where: { id: providerId },
  });
  if (!provider) return err(notFound("Agent provider not found"));
  if (provider.userId !== userId) return err(forbidden("Not your provider"));

  const cardResult = await discoverAgentCard(provider.agentCardUrl);
  if (!cardResult.ok) return cardResult as unknown as Result<AgentProviderResponse>;

  const card = cardResult.data;

  const updated = await prisma.agentProvider.update({
    where: { id: providerId },
    data: {
      endpoint: card.url.replace(/\/+$/, ""),
      cachedSkills: card.skills as unknown as Prisma.InputJsonValue,
      cachedCapabilities: card.capabilities
        ? (card.capabilities as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
      lastDiscoveredAt: new Date(),
    },
  });

  return ok(toResponse(updated));
}

export async function discoverAgentFromUrl(
  agentCardUrl: string
): Promise<Result<AgentCardData>> {
  return discoverAgentCard(agentCardUrl);
}

export async function testAgentProvider(
  userId: string,
  providerId: string
): Promise<Result<{ success: boolean; latencyMs: number; error?: string }>> {
  const provider = await prisma.agentProvider.findUnique({
    where: { id: providerId },
  });
  if (!provider) return err(notFound("Agent provider not found"));
  if (provider.userId !== userId) return err(forbidden("Not your provider"));

  let apiKey: string | undefined;
  if (provider.encryptedApiKey) {
    try {
      apiKey = decryptApiKey(provider.encryptedApiKey);
    } catch {
      return ok({ success: false, latencyMs: 0, error: "Failed to decrypt API key" });
    }
  }

  const start = Date.now();
  const taskId = `test-${Date.now()}`;
  const messages: A2AMessage[] = [
    {
      role: "user",
      parts: [{ type: "text", text: "ping — connectivity test from ContribOS" }],
    },
  ];

  const result = await sendTask(
    provider.endpoint,
    taskId,
    messages,
    apiKey,
    provider.authScheme
  );

  const latencyMs = Date.now() - start;

  if (!result.ok) {
    return ok({ success: false, latencyMs, error: result.error.message });
  }

  return ok({ success: true, latencyMs });
}

// ---------------------------------------------------------------------------
// Default management
// ---------------------------------------------------------------------------

export async function setDefaultAgentProvider(
  userId: string,
  providerId: string | null
): Promise<Result<void>> {
  if (providerId === null) {
    await prisma.agentProvider.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
    return ok(undefined);
  }

  const provider = await prisma.agentProvider.findUnique({
    where: { id: providerId },
  });
  if (!provider) return err(notFound("Agent provider not found"));
  if (provider.userId !== userId) return err(forbidden("Not your provider"));

  await prisma.$transaction([
    prisma.agentProvider.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    }),
    prisma.agentProvider.update({
      where: { id: providerId },
      data: { isDefault: true },
    }),
  ]);

  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Internal getters (for gateway + worker)
// ---------------------------------------------------------------------------

export async function getDecryptedAgentProvider(
  userId: string,
  providerId: string
): Promise<Result<DecryptedAgentProvider>> {
  const provider = await prisma.agentProvider.findUnique({
    where: { id: providerId },
  });
  if (!provider) return err(notFound("Agent provider not found"));
  if (provider.userId !== userId) return err(forbidden("Not your provider"));

  let apiKey: string | null = null;
  if (provider.encryptedApiKey) {
    try {
      apiKey = decryptApiKey(provider.encryptedApiKey);
    } catch {
      return err(validationError("Failed to decrypt agent provider API key"));
    }
  }

  return ok({
    endpoint: provider.endpoint,
    apiKey,
    authScheme: provider.authScheme,
    name: provider.name,
    cachedSkills: provider.cachedSkills,
  });
}

export async function getUserDefaultAgentProvider(
  userId: string
): Promise<string | null> {
  const provider = await prisma.agentProvider.findFirst({
    where: { userId, isDefault: true },
    select: { id: true },
  });
  return provider?.id ?? null;
}

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

const MAX_CUSTOM_PROVIDERS = 10;

export interface CustomProviderInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

export interface CustomProviderResponse {
  id: string;
  name: string;
  baseUrl: string;
  maskedApiKey: string;
  modelId: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TestResult {
  success: boolean;
  latencyMs?: number;
  model?: string;
  error?: string;
}

function toResponse(p: {
  id: string;
  name: string;
  baseUrl: string;
  encryptedApiKey: string;
  modelId: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}): CustomProviderResponse {
  let masked: string;
  try {
    const plain = decryptApiKey(p.encryptedApiKey);
    masked = maskApiKey(plain);
  } catch {
    masked = "****";
  }
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    maskedApiKey: masked,
    modelId: p.modelId,
    isDefault: p.isDefault,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function createCustomProvider(
  userId: string,
  input: CustomProviderInput
): Promise<Result<CustomProviderResponse>> {
  const count = await prisma.customProvider.count({ where: { userId } });
  if (count >= MAX_CUSTOM_PROVIDERS) {
    return err(
      validationError(
        `Maximum ${MAX_CUSTOM_PROVIDERS} custom providers allowed`
      )
    );
  }

  const duplicate = await prisma.customProvider.findUnique({
    where: { userId_name: { userId, name: input.name } },
  });
  if (duplicate) {
    return err(validationError("A custom provider with this name already exists"));
  }

  const encrypted = encryptApiKey(input.apiKey);

  const provider = await prisma.customProvider.create({
    data: {
      userId,
      name: input.name,
      baseUrl: input.baseUrl.replace(/\/+$/, ""),
      encryptedApiKey: encrypted,
      modelId: input.modelId,
    },
  });

  return ok(toResponse(provider));
}

export async function listCustomProviders(
  userId: string
): Promise<Result<CustomProviderResponse[]>> {
  const providers = await prisma.customProvider.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return ok(providers.map(toResponse));
}

export async function updateCustomProvider(
  userId: string,
  providerId: string,
  input: Partial<CustomProviderInput>
): Promise<Result<CustomProviderResponse>> {
  const provider = await prisma.customProvider.findUnique({
    where: { id: providerId },
  });
  if (!provider) return err(notFound("Custom provider not found"));
  if (provider.userId !== userId) return err(forbidden("Not your provider"));

  if (input.name && input.name !== provider.name) {
    const duplicate = await prisma.customProvider.findUnique({
      where: { userId_name: { userId, name: input.name } },
    });
    if (duplicate) {
      return err(validationError("A custom provider with this name already exists"));
    }
  }

  const data: Record<string, unknown> = {};
  if (input.name) data.name = input.name;
  if (input.baseUrl) data.baseUrl = input.baseUrl.replace(/\/+$/, "");
  if (input.modelId) data.modelId = input.modelId;
  if (input.apiKey) data.encryptedApiKey = encryptApiKey(input.apiKey);

  const updated = await prisma.customProvider.update({
    where: { id: providerId },
    data,
  });

  return ok(toResponse(updated));
}

export async function deleteCustomProvider(
  userId: string,
  providerId: string
): Promise<Result<void>> {
  const provider = await prisma.customProvider.findUnique({
    where: { id: providerId },
  });
  if (!provider) return err(notFound("Custom provider not found"));
  if (provider.userId !== userId) return err(forbidden("Not your provider"));

  const activeJobCount = await prisma.job.count({
    where: {
      userId,
      llmProviderOverride: `custom:${providerId}`,
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

  await prisma.customProvider.delete({ where: { id: providerId } });
  return ok(undefined);
}

export async function testCustomProvider(
  userId: string,
  providerId: string
): Promise<Result<TestResult>> {
  const provider = await prisma.customProvider.findUnique({
    where: { id: providerId },
  });
  if (!provider) return err(notFound("Custom provider not found"));
  if (provider.userId !== userId) return err(forbidden("Not your provider"));

  let apiKey: string;
  try {
    apiKey = decryptApiKey(provider.encryptedApiKey);
  } catch {
    return ok({ success: false, error: "Failed to decrypt API key" });
  }

  const start = Date.now();
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: provider.modelId,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    if (res.ok) {
      const data = (await res.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string } }>;
      };
      return ok({
        success: true,
        latencyMs,
        model: data.model ?? provider.modelId,
      });
    }

    const errorText = await res.text().catch(() => "");
    return ok({
      success: false,
      latencyMs,
      error: `HTTP ${res.status}: ${errorText.slice(0, 200)}`,
    });
  } catch (e) {
    const latencyMs = Date.now() - start;
    if (e instanceof Error && e.name === "AbortError") {
      return ok({ success: false, latencyMs, error: "Connection timed out (10s)" });
    }
    return ok({
      success: false,
      latencyMs,
      error: e instanceof Error ? e.message : "Unknown error",
    });
  }
}

export async function setCustomProviderDefault(
  userId: string,
  providerId: string | null
): Promise<Result<void>> {
  if (providerId === null) {
    await prisma.customProvider.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
    return ok(undefined);
  }

  const provider = await prisma.customProvider.findUnique({
    where: { id: providerId },
  });
  if (!provider) return err(notFound("Custom provider not found"));
  if (provider.userId !== userId) return err(forbidden("Not your provider"));

  await prisma.$transaction([
    prisma.customProvider.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    }),
    prisma.customProvider.update({
      where: { id: providerId },
      data: { isDefault: true },
    }),
  ]);

  return ok(undefined);
}

/**
 * Get decrypted provider config for gateway use.
 */
export async function getDecryptedProvider(
  userId: string,
  providerId: string
): Promise<Result<{ baseUrl: string; apiKey: string; modelId: string; name: string }>> {
  const provider = await prisma.customProvider.findUnique({
    where: { id: providerId },
  });
  if (!provider) return err(notFound("Custom provider not found"));
  if (provider.userId !== userId) return err(forbidden("Not your provider"));

  let apiKey: string;
  try {
    apiKey = decryptApiKey(provider.encryptedApiKey);
  } catch {
    return err(validationError("Failed to decrypt provider API key"));
  }

  return ok({
    baseUrl: provider.baseUrl.replace(/\/+$/, ""),
    apiKey,
    modelId: provider.modelId,
    name: provider.name,
  });
}

/**
 * Get the user's default custom provider ID, if one is set.
 */
export async function getUserDefaultCustomProvider(
  userId: string
): Promise<string | null> {
  const provider = await prisma.customProvider.findFirst({
    where: { userId, isDefault: true },
    select: { id: true },
  });
  return provider?.id ?? null;
}

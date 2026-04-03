/**
 * LLM Gateway — unified entry point for all API-side LLM calls.
 * Resolves user defaults, validates against Provider_Catalog,
 * dispatches to the correct adapter, and emits telemetry.
 */

import { prisma } from "../../lib/prisma.js";
import {
  getAdapter,
  isProviderAvailable,
  type LlmCompletionRequest,
  type LlmCompletionResponse,
  type LlmMessage,
  type LlmProviderId,
} from "./provider-registry.js";
import {
  validateProviderModel,
  getDefaultProviderModel,
} from "./provider-catalog.js";
import { providerUnavailable } from "../../common/errors/app-error.js";
import {
  getDecryptedProvider,
  getUserDefaultCustomProvider,
} from "./custom-provider.service.js";
import {
  getDecryptedAgentProvider,
  getUserDefaultAgentProvider,
} from "./agent-provider.service.js";
import {
  sendTaskAndPoll,
  extractDiffFromArtifacts,
  type A2AMessage,
} from "./a2a-client.service.js";

let fastifyLog: { info: (obj: object) => void } | null = null;

/** Inject the Fastify logger so gateway can emit structured telemetry. */
export function setGatewayLogger(logger: { info: (obj: object) => void }): void {
  fastifyLog = logger;
}

export type LlmWorkflow =
  | "calibration"
  | "comprehension"
  | "inbox_guidance"
  | "job_summary";

export type { LlmProviderId };

export interface GatewayRequest {
  workflow: LlmWorkflow;
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
  provider?: LlmProviderId;
  model?: string;
  userId?: string;
}

export interface GatewayResponse {
  text: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  workflow: LlmWorkflow;
}

export interface ResolvedProvider {
  provider: LlmProviderId;
  model: string;
  customOverride?: string;
  agentOverride?: string;
}

/**
 * Resolve provider/model from explicit params, user preferences, or system defaults.
 * Priority: explicit override > explicit enum > user profile prefs > user custom default > system default.
 */
export async function resolveProviderModel(
  explicitProvider?: string,
  explicitModel?: string,
  userId?: string,
  llmProviderOverride?: string | null
): Promise<ResolvedProvider> {
  if (llmProviderOverride?.startsWith("agent:")) {
    return {
      provider: "openai" as LlmProviderId,
      model: "",
      agentOverride: llmProviderOverride,
    };
  }

  if (llmProviderOverride?.startsWith("custom:")) {
    return {
      provider: "openai" as LlmProviderId,
      model: "",
      customOverride: llmProviderOverride,
    };
  }

  if (explicitProvider && explicitModel) {
    return {
      provider: explicitProvider as LlmProviderId,
      model: explicitModel,
    };
  }

  if (userId) {
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { preferredLlmProvider: true, preferredLlmModel: true },
    });

    if (profile?.preferredLlmProvider && profile?.preferredLlmModel) {
      return {
        provider: profile.preferredLlmProvider,
        model: profile.preferredLlmModel,
      };
    }

    const agentDefaultId = await getUserDefaultAgentProvider(userId);
    if (agentDefaultId) {
      return {
        provider: "openai" as LlmProviderId,
        model: "",
        agentOverride: `agent:${agentDefaultId}`,
      };
    }

    const customDefaultId = await getUserDefaultCustomProvider(userId);
    if (customDefaultId) {
      return {
        provider: "openai" as LlmProviderId,
        model: "",
        customOverride: `custom:${customDefaultId}`,
      };
    }
  }

  return getDefaultProviderModel();
}

/**
 * Send a request through the LLM gateway.
 * Validates catalog membership, checks availability, and dispatches.
 * Custom providers bypass catalog validation and use decrypted credentials.
 */
export async function complete(req: GatewayRequest): Promise<GatewayResponse> {
  const resolved = await resolveProviderModel(
    req.provider,
    req.model,
    req.userId
  );

  if (resolved.agentOverride) {
    return completeViaAgentProvider(req, resolved.agentOverride);
  }

  if (resolved.customOverride) {
    return completeViaCustomProvider(req, resolved.customOverride);
  }

  const { provider, model } = resolved;

  const validation = validateProviderModel(provider, model);
  if (!validation.valid) {
    fastifyLog?.info({ msg: "llm_validation_fail", provider, model, reason: validation.reason });
    throw providerUnavailable("Requested LLM provider/model is not available");
  }

  if (!isProviderAvailable(provider)) {
    throw providerUnavailable(
      `Provider "${provider}" API key not configured`
    );
  }

  const adapter = getAdapter(provider);
  if (!adapter) {
    throw providerUnavailable(`No adapter registered for "${provider}"`);
  }

  const completionReq: LlmCompletionRequest = {
    provider,
    model,
    messages: req.messages,
    maxTokens: req.maxTokens,
    temperature: req.temperature,
  };

  let response: LlmCompletionResponse;
  try {
    response = await adapter.complete(completionReq);
  } catch (adapterErr) {
    const message =
      adapterErr instanceof Error ? adapterErr.message : "Unknown adapter error";
    throw providerUnavailable(
      `Provider "${provider}" failed: ${message.slice(0, 120)}`
    );
  }

  fastifyLog?.info({
    msg: "llm_completion",
    workflow: req.workflow,
    provider: response.provider,
    model: response.model,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    latencyMs: response.latencyMs,
  });

  return {
    ...response,
    workflow: req.workflow,
  };
}

async function completeViaCustomProvider(
  req: GatewayRequest,
  customOverride: string
): Promise<GatewayResponse> {
  if (!req.userId) {
    throw providerUnavailable("Custom providers require an authenticated user");
  }

  const providerId = customOverride.replace("custom:", "");
  const providerResult = await getDecryptedProvider(req.userId, providerId);
  if (!providerResult.ok) {
    throw providerUnavailable(providerResult.error.message);
  }

  const { baseUrl, apiKey, modelId, name } = providerResult.data;
  const start = Date.now();

  const messages = req.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let response: Response;
  try {
    response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      }),
    });
  } catch (fetchErr) {
    const message = fetchErr instanceof Error ? fetchErr.message : "Network error";
    throw providerUnavailable(`Custom provider "${name}" unreachable: ${message.slice(0, 120)}`);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw providerUnavailable(
      `Custom provider "${name}" error ${response.status}: ${errorBody.slice(0, 200)}`
    );
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const latencyMs = Date.now() - start;

  fastifyLog?.info({
    msg: "llm_completion",
    workflow: req.workflow,
    provider: `custom:${name}`,
    model: modelId,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    latencyMs,
  });

  return {
    text: data.choices[0]?.message.content ?? "",
    provider: `custom:${name}`,
    model: modelId,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    latencyMs,
    workflow: req.workflow,
  };
}

async function completeViaAgentProvider(
  req: GatewayRequest,
  agentOverride: string
): Promise<GatewayResponse> {
  if (!req.userId) {
    throw providerUnavailable("Agent providers require an authenticated user");
  }

  const providerId = agentOverride.replace("agent:", "");
  const providerResult = await getDecryptedAgentProvider(req.userId, providerId);
  if (!providerResult.ok) {
    throw providerUnavailable(providerResult.error.message);
  }

  const { endpoint, apiKey, authScheme, name } = providerResult.data;
  const start = Date.now();

  const userContent = req.messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n\n");

  const messages: A2AMessage[] = [
    {
      role: "user",
      parts: [{ type: "text", text: userContent }],
    },
  ];

  const taskResult = await sendTaskAndPoll(
    endpoint,
    messages,
    apiKey ?? undefined,
    authScheme
  );

  const latencyMs = Date.now() - start;

  if (!taskResult.ok) {
    throw providerUnavailable(
      `Agent provider "${name}" task failed: ${taskResult.error.message}`
    );
  }

  const task = taskResult.data;

  if (task.status.state === "failed") {
    const errMsg = task.status.message?.parts
      ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join(" ") ?? "Task failed without details";
    throw providerUnavailable(`Agent provider "${name}" failed: ${errMsg}`);
  }

  let responseText = "";
  if (task.artifacts && task.artifacts.length > 0) {
    responseText = extractDiffFromArtifacts(task.artifacts) ?? "";
  }
  if (!responseText && task.status.message) {
    const textParts = task.status.message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text);
    responseText = textParts.join("\n");
  }

  fastifyLog?.info({
    msg: "llm_completion",
    workflow: req.workflow,
    provider: `agent:${name}`,
    model: "a2a",
    inputTokens: 0,
    outputTokens: 0,
    latencyMs,
    agentTaskId: task.id,
    agentTaskState: task.status.state,
  });

  return {
    text: responseText,
    provider: `agent:${name}`,
    model: "a2a",
    inputTokens: 0,
    outputTokens: 0,
    latencyMs,
    workflow: req.workflow,
  };
}

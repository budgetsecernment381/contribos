/**
 * Provider adapter registry — abstracts LLM provider API differences behind
 * a uniform interface for the API-side gateway (calibration, comprehension,
 * inbox guidance, job summary).
 *
 * Providers using the OpenAI-compatible chat completions schema share a single
 * parameterized adapter factory to avoid duplication.
 */

import { getEnv } from "../../common/config/env.js";

export type LlmProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "perplexity"
  | "mistral"
  | "groq"
  | "deepseek"
  | "xai";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmCompletionRequest {
  provider: LlmProviderId;
  model: string;
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface LlmCompletionResponse {
  text: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

interface ProviderAdapter {
  complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse>;
  isAvailable(): boolean;
}

// ---------------------------------------------------------------------------
// Anthropic — unique Messages API format
// ---------------------------------------------------------------------------

async function anthropicComplete(
  req: LlmCompletionRequest
): Promise<LlmCompletionResponse> {
  const start = Date.now();
  const env = getEnv();

  const systemMsg = req.messages.find((m) => m.role === "system");
  const userMsgs = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.CLAUDE_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: userMsgs,
      ...(req.temperature !== undefined
        ? { temperature: req.temperature }
        : {}),
    }),
  });

  if (response.ok) {
    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    return {
      text,
      provider: "anthropic",
      model: req.model,
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      latencyMs: Date.now() - start,
    };
  }

  const errorBody = await response.text();
  throw new Error(
    `Anthropic API error ${response.status}: ${errorBody.slice(0, 200)}`
  );
}

// ---------------------------------------------------------------------------
// Google Generative AI — unique generateContent format
// ---------------------------------------------------------------------------

async function googleComplete(
  req: LlmCompletionRequest
): Promise<LlmCompletionResponse> {
  const start = Date.now();
  const env = getEnv();
  const apiKey = env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY not configured");

  const systemInstruction = req.messages.find((m) => m.role === "system");
  const contents = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents,
      ...(systemInstruction
        ? {
            systemInstruction: {
              parts: [{ text: systemInstruction.content }],
            },
          }
        : {}),
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 4096,
        ...(req.temperature !== undefined
          ? { temperature: req.temperature }
          : {}),
      },
    }),
  });

  if (response.ok) {
    const data = (await response.json()) as {
      candidates: Array<{
        content: { parts: Array<{ text: string }> };
      }>;
      usageMetadata?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
      };
    };

    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text)
        .join("") ?? "";

    return {
      text,
      provider: "google",
      model: req.model,
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      latencyMs: Date.now() - start,
    };
  }

  const errorBody = await response.text();
  throw new Error(
    `Google AI API error ${response.status}: ${errorBody.slice(0, 200)}`
  );
}

// ---------------------------------------------------------------------------
// OpenAI-compatible adapter factory — shared by OpenAI, Perplexity, Mistral,
// Groq, DeepSeek, and xAI (all use the chat/completions schema)
// ---------------------------------------------------------------------------

function createOpenAICompatibleAdapter(
  providerId: string,
  baseUrl: string,
  envKeyField: keyof ReturnType<typeof getEnv>,
): ProviderAdapter {
  const completeFn = async (
    req: LlmCompletionRequest
  ): Promise<LlmCompletionResponse> => {
    const start = Date.now();
    const env = getEnv();
    const apiKey = env[envKeyField] as string | undefined;
    if (!apiKey) throw new Error(`${envKeyField} not configured`);

    const messages = req.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 4096,
        messages,
        ...(req.temperature !== undefined
          ? { temperature: req.temperature }
          : {}),
      }),
    });

    if (response.ok) {
      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
        usage: { prompt_tokens: number; completion_tokens: number };
      };

      return {
        text: data.choices[0]?.message.content ?? "",
        provider: providerId,
        model: req.model,
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        latencyMs: Date.now() - start,
      };
    }

    const errorBody = await response.text();
    throw new Error(
      `${providerId} API error ${response.status}: ${errorBody.slice(0, 200)}`
    );
  };

  return {
    complete: completeFn,
    isAvailable: () => !!(getEnv()[envKeyField]),
  };
}

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

const adapters: Record<string, ProviderAdapter> = {
  anthropic: {
    complete: anthropicComplete,
    isAvailable: () => !!getEnv().CLAUDE_API_KEY,
  },
  google: {
    complete: googleComplete,
    isAvailable: () => !!getEnv().GOOGLE_AI_API_KEY,
  },
  openai: createOpenAICompatibleAdapter(
    "openai",
    "https://api.openai.com/v1",
    "OPENAI_API_KEY",
  ),
  perplexity: createOpenAICompatibleAdapter(
    "perplexity",
    "https://api.perplexity.ai",
    "PERPLEXITY_API_KEY",
  ),
  mistral: createOpenAICompatibleAdapter(
    "mistral",
    "https://api.mistral.ai/v1",
    "MISTRAL_API_KEY",
  ),
  groq: createOpenAICompatibleAdapter(
    "groq",
    "https://api.groq.com/openai/v1",
    "GROQ_API_KEY",
  ),
  deepseek: createOpenAICompatibleAdapter(
    "deepseek",
    "https://api.deepseek.com/v1",
    "DEEPSEEK_API_KEY",
  ),
  xai: createOpenAICompatibleAdapter(
    "xai",
    "https://api.x.ai/v1",
    "XAI_API_KEY",
  ),
};

/** Get the adapter for a given provider ID. */
export function getAdapter(provider: string): ProviderAdapter | undefined {
  return adapters[provider];
}

/** Check if a specific provider is available (has API key configured). */
export function isProviderAvailable(provider: string): boolean {
  return adapters[provider]?.isAvailable() ?? false;
}

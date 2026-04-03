/**
 * Static provider catalog defining which LLM providers/models are available.
 * Server-maintained allowlist — only entries here are selectable by users.
 */

import type { LlmProviderId } from "./provider-registry.js";

export interface ModelEntry {
  id: string;
  name: string;
  maxTokens: number;
  costPer1kInput: number;
  costPer1kOutput: number;
  supportsTools: boolean;
}

export interface ProviderEntry {
  id: LlmProviderId;
  name: string;
  enabled: boolean;
  models: ModelEntry[];
  envKey: string;
}

const PROVIDER_CATALOG: ProviderEntry[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    enabled: true,
    envKey: "CLAUDE_API_KEY",
    models: [
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        maxTokens: 8192,
        costPer1kInput: 0.003,
        costPer1kOutput: 0.015,
        supportsTools: true,
      },
      {
        id: "claude-haiku-3-20250307",
        name: "Claude Haiku 3",
        maxTokens: 4096,
        costPer1kInput: 0.00025,
        costPer1kOutput: 0.00125,
        supportsTools: true,
      },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    enabled: true,
    envKey: "OPENAI_API_KEY",
    models: [
      {
        id: "gpt-4o",
        name: "GPT-4o",
        maxTokens: 4096,
        costPer1kInput: 0.005,
        costPer1kOutput: 0.015,
        supportsTools: true,
      },
      {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        maxTokens: 4096,
        costPer1kInput: 0.00015,
        costPer1kOutput: 0.0006,
        supportsTools: true,
      },
    ],
  },
  {
    id: "google",
    name: "Google",
    enabled: true,
    envKey: "GOOGLE_AI_API_KEY",
    models: [
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        maxTokens: 8192,
        costPer1kInput: 0.00015,
        costPer1kOutput: 0.0006,
        supportsTools: true,
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        maxTokens: 8192,
        costPer1kInput: 0.00125,
        costPer1kOutput: 0.005,
        supportsTools: true,
      },
    ],
  },
  {
    id: "perplexity",
    name: "Perplexity",
    enabled: true,
    envKey: "PERPLEXITY_API_KEY",
    models: [
      {
        id: "sonar-pro",
        name: "Sonar Pro",
        maxTokens: 4096,
        costPer1kInput: 0.003,
        costPer1kOutput: 0.015,
        supportsTools: false,
      },
      {
        id: "sonar",
        name: "Sonar",
        maxTokens: 4096,
        costPer1kInput: 0.001,
        costPer1kOutput: 0.001,
        supportsTools: false,
      },
    ],
  },
  {
    id: "mistral",
    name: "Mistral",
    enabled: true,
    envKey: "MISTRAL_API_KEY",
    models: [
      {
        id: "mistral-large-latest",
        name: "Mistral Large",
        maxTokens: 8192,
        costPer1kInput: 0.002,
        costPer1kOutput: 0.006,
        supportsTools: true,
      },
      {
        id: "mistral-small-latest",
        name: "Mistral Small",
        maxTokens: 8192,
        costPer1kInput: 0.0002,
        costPer1kOutput: 0.0006,
        supportsTools: true,
      },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    enabled: true,
    envKey: "GROQ_API_KEY",
    models: [
      {
        id: "llama-3.3-70b-versatile",
        name: "Llama 3.3 70B",
        maxTokens: 8192,
        costPer1kInput: 0.00059,
        costPer1kOutput: 0.00079,
        supportsTools: true,
      },
      {
        id: "mixtral-8x7b-32768",
        name: "Mixtral 8x7B",
        maxTokens: 32768,
        costPer1kInput: 0.00024,
        costPer1kOutput: 0.00024,
        supportsTools: true,
      },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    enabled: true,
    envKey: "DEEPSEEK_API_KEY",
    models: [
      {
        id: "deepseek-chat",
        name: "DeepSeek Chat",
        maxTokens: 8192,
        costPer1kInput: 0.00014,
        costPer1kOutput: 0.00028,
        supportsTools: true,
      },
      {
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner",
        maxTokens: 8192,
        costPer1kInput: 0.00055,
        costPer1kOutput: 0.00219,
        supportsTools: false,
      },
    ],
  },
  {
    id: "xai",
    name: "xAI",
    enabled: true,
    envKey: "XAI_API_KEY",
    models: [
      {
        id: "grok-3",
        name: "Grok 3",
        maxTokens: 8192,
        costPer1kInput: 0.003,
        costPer1kOutput: 0.015,
        supportsTools: true,
      },
      {
        id: "grok-3-mini",
        name: "Grok 3 Mini",
        maxTokens: 8192,
        costPer1kInput: 0.0003,
        costPer1kOutput: 0.0005,
        supportsTools: true,
      },
    ],
  },
];

/** Return the full catalog (all entries, including disabled). */
export function getFullCatalog(): ProviderEntry[] {
  return PROVIDER_CATALOG;
}

/** Return only providers whose API key env var is set. */
export function getAvailableCatalog(): ProviderEntry[] {
  return PROVIDER_CATALOG.filter(
    (p) => p.enabled && !!process.env[p.envKey]
  );
}

/** Validate that a provider/model pair exists in the catalog. */
export function validateProviderModel(
  provider: string,
  model: string
): { valid: boolean; reason?: string } {
  const entry = PROVIDER_CATALOG.find((p) => p.id === provider);
  if (!entry) {
    return { valid: false, reason: `Provider "${provider}" not in catalog` };
  }
  if (!entry.enabled) {
    return { valid: false, reason: `Provider "${provider}" is disabled` };
  }
  const modelEntry = entry.models.find((m) => m.id === model);
  if (!modelEntry) {
    return {
      valid: false,
      reason: `Model "${model}" not available for provider "${provider}"`,
    };
  }
  return { valid: true };
}

/**
 * Get the default provider and model.
 * Returns the first available provider from the catalog, falling back
 * to anthropic if no keys are configured (will fail at call time).
 */
export function getDefaultProviderModel(): {
  provider: LlmProviderId;
  model: string;
} {
  const available = getAvailableCatalog();
  if (available.length > 0) {
    return { provider: available[0].id, model: available[0].models[0].id };
  }
  return { provider: "anthropic", model: "claude-sonnet-4-20250514" };
}

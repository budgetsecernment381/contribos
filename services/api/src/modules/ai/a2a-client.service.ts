/**
 * A2A (Agent-to-Agent) JSON-RPC 2.0 client service.
 * Handles Agent Card discovery, task lifecycle (send/get/cancel),
 * and SSRF protection for Agent Card URLs.
 */

import { randomUUID } from "crypto";
import type { Result } from "../../common/types/result.js";
import { ok, err } from "../../common/types/result.js";
import { validationError } from "../../common/errors/app-error.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
}

export interface AgentCardData {
  name: string;
  description?: string;
  url: string;
  version?: string;
  skills: AgentSkill[];
  capabilities?: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  authSchemes?: Array<{
    scheme: string;
    params?: Record<string, unknown>;
  }>;
}

export type A2APart =
  | { type: "text"; text: string }
  | { type: "file"; file: { name: string; mimeType?: string; bytes?: string; uri?: string } }
  | { type: "data"; data: Record<string, unknown> };

export interface A2AMessage {
  role: "user" | "agent";
  parts: A2APart[];
}

export interface A2AArtifact {
  name?: string;
  description?: string;
  parts: A2APart[];
  index?: number;
  lastChunk?: boolean;
}

export type A2ATaskStatus =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "canceled";

export interface A2ATaskResponse {
  id: string;
  status: {
    state: A2ATaskStatus;
    message?: A2AMessage;
    timestamp?: string;
  };
  artifacts?: A2AArtifact[];
  history?: Array<{ role: string; parts: A2APart[] }>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: A2ATaskResponse;
  error?: { code: number; message: string; data?: unknown };
}

// ---------------------------------------------------------------------------
// SSRF Protection
// ---------------------------------------------------------------------------

const PRIVATE_IP_PATTERNS = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^fc00:/i,
  /^fe80:/i,
  /^::1$/,
  /^localhost$/i,
];

function isPrivateHost(hostname: string): boolean {
  return PRIVATE_IP_PATTERNS.some((p) => p.test(hostname));
}

export function validateAgentUrl(urlStr: string): Result<URL> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return err(validationError("Invalid URL format"));
  }

  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    return err(validationError("Agent Card URL must use HTTPS in production"));
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return err(validationError("Agent Card URL must use HTTP or HTTPS"));
  }

  if (isPrivateHost(url.hostname)) {
    return err(validationError("Agent Card URL must not point to a private network address"));
  }

  return ok(url);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const TASK_POLL_INTERVAL_MS = 2_000;
const TASK_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function buildAuthHeaders(
  apiKey?: string,
  authScheme = "bearer"
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (!apiKey) return headers;

  switch (authScheme.toLowerCase()) {
    case "bearer":
      headers["Authorization"] = `Bearer ${apiKey}`;
      break;
    case "api-key":
    case "apikey":
      headers["x-api-key"] = apiKey;
      break;
    default:
      headers["Authorization"] = `Bearer ${apiKey}`;
  }
  return headers;
}

function buildJsonRpcRequest(
  method: string,
  params: Record<string, unknown>
): { jsonrpc: "2.0"; id: string; method: string; params: Record<string, unknown> } {
  return {
    jsonrpc: "2.0",
    id: randomUUID(),
    method,
    params,
  };
}

// ---------------------------------------------------------------------------
// Agent Card Discovery
// ---------------------------------------------------------------------------

export async function discoverAgentCard(
  rawUrl: string
): Promise<Result<AgentCardData>> {
  let cardUrl = rawUrl.replace(/\/+$/, "");
  if (!cardUrl.endsWith("/.well-known/agent.json") && !cardUrl.endsWith("/agent.json")) {
    cardUrl += "/.well-known/agent.json";
  }

  const urlResult = validateAgentUrl(cardUrl);
  if (!urlResult.ok) return urlResult as Result<AgentCardData>;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    const res = await fetch(cardUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return err(
        validationError(`Agent Card fetch failed: HTTP ${res.status}`)
      );
    }

    const data = (await res.json()) as Record<string, unknown>;

    if (!data.name || typeof data.name !== "string") {
      return err(validationError("Invalid Agent Card: missing 'name' field"));
    }
    if (!data.url || typeof data.url !== "string") {
      return err(validationError("Invalid Agent Card: missing 'url' field"));
    }

    const skills: AgentSkill[] = [];
    if (Array.isArray(data.skills)) {
      for (const s of data.skills) {
        if (s && typeof s === "object" && typeof s.id === "string" && typeof s.name === "string") {
          skills.push({
            id: s.id,
            name: s.name,
            description: typeof s.description === "string" ? s.description : undefined,
            tags: Array.isArray(s.tags) ? s.tags.filter((t: unknown) => typeof t === "string") : undefined,
          });
        }
      }
    }

    const capabilities = data.capabilities as AgentCardData["capabilities"] | undefined;

    const agentCard: AgentCardData = {
      name: data.name as string,
      description: typeof data.description === "string" ? data.description : undefined,
      url: data.url as string,
      version: typeof data.version === "string" ? data.version : undefined,
      skills,
      capabilities: capabilities ?? undefined,
      authSchemes: Array.isArray(data.authentication)
        ? (data.authentication as AgentCardData["authSchemes"])
        : undefined,
    };

    return ok(agentCard);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return err(validationError("Agent Card fetch timed out (30s)"));
    }
    const msg = e instanceof Error ? e.message : "Unknown error";
    return err(validationError(`Unable to reach Agent Card URL: ${msg}`));
  }
}

// ---------------------------------------------------------------------------
// Task Lifecycle
// ---------------------------------------------------------------------------

export async function sendTask(
  endpoint: string,
  taskId: string,
  messages: A2AMessage[],
  apiKey?: string,
  authScheme?: string
): Promise<Result<A2ATaskResponse>> {
  const headers = buildAuthHeaders(apiKey, authScheme);
  const body = buildJsonRpcRequest("tasks/send", {
    id: taskId,
    message: messages[messages.length - 1],
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      return err(
        validationError(
          `A2A tasks/send failed: HTTP ${res.status} — ${errorText.slice(0, 200)}`
        )
      );
    }

    const rpcResponse = (await res.json()) as JsonRpcResponse;
    if (rpcResponse.error) {
      return err(
        validationError(
          `A2A JSON-RPC error ${rpcResponse.error.code}: ${rpcResponse.error.message}`
        )
      );
    }

    if (!rpcResponse.result) {
      return err(validationError("A2A response missing result"));
    }

    return ok(rpcResponse.result);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return err(validationError("A2A tasks/send timed out (30s)"));
    }
    const msg = e instanceof Error ? e.message : "Unknown error";
    return err(validationError(`A2A agent unreachable: ${msg}`));
  }
}

export async function getTask(
  endpoint: string,
  taskId: string,
  apiKey?: string,
  authScheme?: string
): Promise<Result<A2ATaskResponse>> {
  const headers = buildAuthHeaders(apiKey, authScheme);
  const body = buildJsonRpcRequest("tasks/get", { id: taskId });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      return err(
        validationError(
          `A2A tasks/get failed: HTTP ${res.status} — ${errorText.slice(0, 200)}`
        )
      );
    }

    const rpcResponse = (await res.json()) as JsonRpcResponse;
    if (rpcResponse.error) {
      return err(
        validationError(
          `A2A JSON-RPC error ${rpcResponse.error.code}: ${rpcResponse.error.message}`
        )
      );
    }

    if (!rpcResponse.result) {
      return err(validationError("A2A response missing result"));
    }

    return ok(rpcResponse.result);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return err(validationError("A2A tasks/get timed out (30s)"));
    }
    const msg = e instanceof Error ? e.message : "Unknown error";
    return err(validationError(`A2A agent unreachable: ${msg}`));
  }
}

export async function cancelTask(
  endpoint: string,
  taskId: string,
  apiKey?: string,
  authScheme?: string
): Promise<Result<void>> {
  const headers = buildAuthHeaders(apiKey, authScheme);
  const body = buildJsonRpcRequest("tasks/cancel", { id: taskId });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return ok(undefined);
  } catch {
    return ok(undefined);
  }
}

// ---------------------------------------------------------------------------
// Task Polling (send + poll until terminal state)
// ---------------------------------------------------------------------------

export async function sendTaskAndPoll(
  endpoint: string,
  messages: A2AMessage[],
  apiKey?: string,
  authScheme?: string,
  timeoutMs = TASK_DEFAULT_TIMEOUT_MS
): Promise<Result<A2ATaskResponse>> {
  const taskId = randomUUID();

  const sendResult = await sendTask(endpoint, taskId, messages, apiKey, authScheme);
  if (!sendResult.ok) return sendResult;

  let task = sendResult.data;
  const terminalStates: A2ATaskStatus[] = ["completed", "failed", "canceled"];

  if (terminalStates.includes(task.status.state)) {
    return ok(task);
  }

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, TASK_POLL_INTERVAL_MS));

    const getResult = await getTask(endpoint, taskId, apiKey, authScheme);
    if (!getResult.ok) return getResult;

    task = getResult.data;

    if (terminalStates.includes(task.status.state)) {
      return ok(task);
    }

    if (task.status.state === "input-required") {
      return err(
        validationError("A2A agent requires additional input — not supported in this version")
      );
    }
  }

  await cancelTask(endpoint, taskId, apiKey, authScheme);
  return err(
    validationError(`A2A task timed out after ${Math.round(timeoutMs / 1000)}s`)
  );
}

// ---------------------------------------------------------------------------
// Artifact Extraction
// ---------------------------------------------------------------------------

const DIFF_MARKERS = ["diff --git", "--- a/", "+++ b/", "--- ", "+++ ", "@@ -"];

export function extractDiffFromArtifacts(artifacts: A2AArtifact[]): string | null {
  for (const artifact of artifacts) {
    for (const part of artifact.parts) {
      if (part.type === "text" && part.text) {
        if (DIFF_MARKERS.some((m) => part.text.includes(m))) {
          let text = part.text.trim();
          if (text.startsWith("```")) {
            const firstNewline = text.indexOf("\n");
            text = text.slice(firstNewline + 1);
            if (text.endsWith("```")) {
              text = text.slice(0, -3);
            }
          }
          return text.trim();
        }
      }
    }
  }

  for (const artifact of artifacts) {
    for (const part of artifact.parts) {
      if (part.type === "text" && part.text && part.text.trim().length > 0) {
        return part.text.trim();
      }
    }
  }

  return null;
}

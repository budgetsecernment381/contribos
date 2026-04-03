import { useAuthStore } from "@/stores/auth-store";

const BASE_URL = import.meta.env.VITE_API_URL ?? "/api/v1";

/** Single-flight refresh so concurrent 401s share one /auth/refresh call. */
let refreshInFlight: Promise<boolean> | null = null;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function refreshToken(): Promise<boolean> {
  if (refreshInFlight) {
    return refreshInFlight;
  }
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.accessToken) {
        useAuthStore.getState().setAccessToken(data.accessToken);
        return true;
      }
      return false;
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error("[api] Token refresh failed", e);
      }
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function fetchWithAuth(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = useAuthStore.getState().accessToken;
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  };
  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }

  let res = await fetch(url, { ...options, headers, credentials: "include" });

  if (res.status === 401) {
    const refreshed = await refreshToken();
    if (refreshed) {
      const newToken = useAuthStore.getState().accessToken;
      const newHeaders: HeadersInit = {
        ...headers,
        Authorization: newToken ? `Bearer ${newToken}` : "",
      };
      res = await fetch(url, { ...options, headers: newHeaders, credentials: "include" });
    }
  }

  return res;
}

function mapError(status: number, body: unknown): ApiError {
  const data = body as { message?: string; code?: string; details?: unknown };
  const message = data?.message ?? `Request failed with status ${status}`;
  const code = data?.code;
  const details = data?.details;
  return new ApiError(message, status, code, details);
}

export async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const res = await fetchWithAuth(url, options);

  let body: unknown;
  const contentType = res.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    try {
      body = await res.json();
    } catch {
      body = null;
    }
  } else {
    body = await res.text();
  }

  if (!res.ok) {
    throw mapError(res.status, body);
  }

  return body as T;
}

export const apiClient = {
  get: <T>(path: string) => api<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    api<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    api<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    api<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => api<T>(path, { method: "DELETE" }),
};

import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore, type User } from "@/stores/auth-store";

const BASE = "/api/v1";
const GITHUB_OAUTH_URL = `${BASE}/auth/github`;

function mapApiUser(raw: Record<string, unknown>): User {
  return {
    id: raw.id as string,
    username:
      (raw.githubUsername as string) ??
      (raw.username as string) ??
      (raw.login as string) ??
      "",
    email: (raw.email as string) ?? undefined,
    avatarUrl: (raw.avatarUrl as string) ?? (raw.avatar_url as string) ?? undefined,
    tier: (raw.tier as 1 | 2 | 3 | 4) ?? undefined,
    onboardingComplete: (raw.onboardingComplete as boolean) ?? undefined,
    slug: (raw.shareableSlug as string) ?? (raw.slug as string) ?? undefined,
    isAdmin: raw.role === "admin",
  };
}

export function useAuth() {
  const navigate = useNavigate();
  const { user, accessToken, isHydrated, setUser, setAccessToken, setHydrated, logout: storeLogout } = useAuthStore();

  const login = useCallback(() => {
    window.location.href = GITHUB_OAUTH_URL;
  }, []);

  const logout = useCallback(() => {
    storeLogout();
    fetch(`${BASE}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
    navigate("/");
  }, [storeLogout, navigate]);

  const refreshToken = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.accessToken) {
        setAccessToken(data.accessToken);
        if (data.user) setUser(mapApiUser(data.user));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [setAccessToken, setUser]);

  const hydrate = useCallback(async () => {
    const token = useAuthStore.getState().accessToken;
    if (!token) {
      const refreshed = await refreshToken();
      if (!refreshed) {
        setHydrated(true);
        return;
      }
    }

    try {
      const currentToken = useAuthStore.getState().accessToken;
      const headers: HeadersInit = {};
      if (currentToken) {
        headers["Authorization"] = `Bearer ${currentToken}`;
      }
      const res = await fetch(`${BASE}/auth/me`, {
        credentials: "include",
        headers,
      });
      if (!res.ok) {
        if (res.status === 401) {
          const refreshed = await refreshToken();
          if (refreshed) {
            const retryToken = useAuthStore.getState().accessToken;
            const retryRes = await fetch(`${BASE}/auth/me`, {
              credentials: "include",
              headers:
                retryToken && retryToken !== "cookie"
                  ? { Authorization: `Bearer ${retryToken}` }
                  : {},
            });
            if (retryRes.ok) {
              const data = await retryRes.json();
              setUser(mapApiUser(data.user ?? data));
            }
          }
        }
        setHydrated(true);
        return;
      }
      const data = await res.json();
      setUser(mapApiUser(data.user ?? data));
    } catch {
      // Network error — leave user as-is
    } finally {
      setHydrated(true);
    }
  }, [setUser, setHydrated, refreshToken]);

  return {
    user,
    accessToken,
    isAuthenticated: !!accessToken && !!user,
    isHydrated,
    login,
    logout,
    refreshToken,
    hydrate,
  };
}

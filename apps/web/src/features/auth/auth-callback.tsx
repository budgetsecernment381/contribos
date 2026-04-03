import { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/auth-store";

export function AuthCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const setUser = useAuthStore((s) => s.setUser);
  const setAccessToken = useAuthStore((s) => s.setAccessToken);
  const setHydrated = useAuthStore((s) => s.setHydrated);
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    (async () => {
      try {
        const res = await fetch("/api/v1/auth/me", { credentials: "include" });
        if (!res.ok) {
          navigate("/", { replace: true });
          return;
        }
        const data = await res.json();
        const raw = data.user ?? data;

        setAccessToken("cookie");

        setUser({
          id: raw.id,
          username: raw.githubUsername ?? raw.username ?? raw.login ?? "",
          email: raw.email,
          avatarUrl: raw.avatarUrl ?? raw.avatar_url,
          tier: raw.tier,
          onboardingComplete: raw.onboardingComplete,
          isAdmin: raw.role === "admin",
        });

        setHydrated(true);

        const from =
          (location.state as { from?: { pathname: string } })?.from?.pathname ??
          "/dashboard";
        navigate(from, { replace: true });
      } catch {
        navigate("/", { replace: true });
      }
    })();
  }, [location.state, navigate, setUser, setAccessToken, setHydrated]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Completing sign in...</p>
      </div>
    </div>
  );
}

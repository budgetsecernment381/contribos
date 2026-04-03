import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireOnboarding?: boolean;
  requireAdmin?: boolean;
}

export function ProtectedRoute({
  children,
  requireOnboarding = true,
  requireAdmin = false,
}: ProtectedRouteProps) {
  const { user, isAuthenticated, hydrate, isHydrated } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!isHydrated) {
      hydrate();
    }
  }, [hydrate, isHydrated]);

  if (!isHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  if (requireOnboarding && user && !user.onboardingComplete) {
    return <Navigate to="/onboarding" state={{ from: location }} replace />;
  }

  if (requireAdmin && user && !user.isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

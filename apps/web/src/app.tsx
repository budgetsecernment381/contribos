import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { ProtectedRoute } from "@/components/layout/protected-route";
import { LandingPage } from "@/features/landing/landing-page";
import { AuthCallback } from "@/features/auth/auth-callback";
import { OnboardingFlow } from "@/features/onboarding/onboarding-flow";
import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { IssueList } from "@/features/issues/issue-list";
import { IssueDetail } from "@/features/issues/issue-detail";
import { JobStatus } from "@/features/jobs/job-status";
import { ReviewGate } from "@/features/review/review-gate";
import { PRFeed } from "@/features/prs/pr-feed";
import { InboxList } from "@/features/inbox/inbox-list";
import { InboxDetail } from "@/features/inbox/inbox-detail";
import { PublicProfile } from "@/features/profile/public-profile";
import { ProfileSettings } from "@/features/profile/profile-settings";
import { ProviderSettings } from "@/features/settings/provider-settings";
import { CreditsPage } from "@/features/credits/credits-page";
import { AdminRepos } from "@/features/admin/admin-repos";
import { AdminPrestige } from "@/features/admin/admin-prestige";
import { AdminPolicy } from "@/features/admin/admin-policy";
import { AdminScheduler } from "@/features/admin/admin-scheduler";
import { AdminUsers } from "@/features/admin/admin-users";
import { TooltipProvider } from "@/components/ui/tooltip";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
  mutationCache: new MutationCache({
    onError: (error: Error) => {
      toast.error(error.message || "Something went wrong");
    },
  }),
});

function AuthInit() {
  const { hydrate } = useAuth();
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <TooltipProvider>
          <BrowserRouter>
            <AuthInit />
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route
                path="/onboarding"
                element={
                  <ProtectedRoute requireOnboarding={false}>
                    <OnboardingFlow />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <DashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/issues"
                element={
                  <ProtectedRoute>
                    <IssueList />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/issues/:issueId"
                element={
                  <ProtectedRoute>
                    <IssueDetail />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/jobs/:jobId"
                element={
                  <ProtectedRoute>
                    <JobStatus />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/review/:reviewId"
                element={
                  <ProtectedRoute>
                    <ReviewGate />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/prs"
                element={
                  <ProtectedRoute>
                    <PRFeed />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/inbox"
                element={
                  <ProtectedRoute>
                    <InboxList />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/inbox/:itemId"
                element={
                  <ProtectedRoute>
                    <InboxDetail />
                  </ProtectedRoute>
                }
              />
              <Route path="/profile/:slug" element={<PublicProfile />} />
              <Route
                path="/settings/profile"
                element={
                  <ProtectedRoute>
                    <ProfileSettings />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings/providers"
                element={
                  <ProtectedRoute>
                    <ProviderSettings />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/credits"
                element={
                  <ProtectedRoute>
                    <CreditsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/repos"
                element={
                  <ProtectedRoute requireAdmin>
                    <AdminRepos />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/prestige"
                element={
                  <ProtectedRoute requireAdmin>
                    <AdminPrestige />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/policy"
                element={
                  <ProtectedRoute requireAdmin>
                    <AdminPolicy />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/scheduler"
                element={
                  <ProtectedRoute requireAdmin>
                    <AdminScheduler />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/users"
                element={
                  <ProtectedRoute requireAdmin>
                    <AdminUsers />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            <Toaster />
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

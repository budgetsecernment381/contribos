import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, Inbox, Zap, Play, Loader2, Clock, ExternalLink, X, FileCheck, Send, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TierBadge } from "@/components/shared/tier-badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatsCard } from "@/components/shared/stats-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ProviderSelector } from "@/components/shared/provider-selector";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";

interface ClaimedIssue {
  id: string;
  title: string;
  repoFullName: string;
  compositeScore: number;
  minimumTier: number;
  claimStatus: string;
  ecosystem: string;
  claimedAt: string | null;
  latestJobId: string | null;
  latestJobStatus: string | null;
  latestReviewId: string | null;
  latestReviewPrType: string | null;
}

interface JobListItem {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "review_pending" | "approved" | "submitted" | "rejected";
  confidenceScore: number | null;
  diffLinesChanged: number | null;
  createdAt: string;
  reviewId: string | null;
  reviewPrType: string | null;
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [runningIssueIds, setRunningIssueIds] = useState<Set<string>>(
    new Set()
  );
  const [selectedProvider, setSelectedProvider] = useState("default");

  const { data: creditData } = useQuery({
    queryKey: ["credits-balance"],
    queryFn: () => apiClient.get<{ balance: number; planTier: string }>("/credits/balance"),
    placeholderData: { balance: 0, planTier: "free" },
  });

  const { data: reputationData } = useQuery({
    queryKey: ["reputation-score"],
    queryFn: () => apiClient.get<{ contributionHealthScore: number }>("/reputation/score"),
    placeholderData: { contributionHealthScore: 0 },
  });

  const { data: claimedIssues = [], isLoading: claimsLoading } = useQuery({
    queryKey: ["claimed-issues"],
    queryFn: () => apiClient.get<ClaimedIssue[]>("/issues/claimed"),
    refetchInterval: 10000,
    placeholderData: [],
  });

  const { data: recentJobs = [] } = useQuery({
    queryKey: ["jobs-list"],
    queryFn: () => apiClient.get<JobListItem[]>("/jobs?limit=5"),
    refetchInterval: 5000,
    placeholderData: [],
  });

  async function runAgentForIssue(issueId: string): Promise<void> {
    if (runningIssueIds.has(issueId)) return;
    setRunningIssueIds((prev) => new Set(prev).add(issueId));
    try {
      const jobPayload: Record<string, string> = {
        issueId,
        familiarityLevel: "occasional",
        fixIntent: "correct_complete",
      };
      if (selectedProvider !== "default") {
        if (selectedProvider.startsWith("custom:") || selectedProvider.startsWith("agent:")) {
          jobPayload.llmProviderOverride = selectedProvider;
        } else {
          jobPayload.llmProvider = selectedProvider;
        }
      }
      const data = await apiClient.post<{ jobId: string }>("/jobs", jobPayload);
      toast.success("Agent job queued");
      queryClient.invalidateQueries({ queryKey: ["claimed-issues"] });
      queryClient.invalidateQueries({ queryKey: ["jobs-list"] });
      if (data?.jobId) {
        navigate(`/jobs/${data.jobId}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to queue job");
    } finally {
      setRunningIssueIds((prev) => {
        const next = new Set(prev);
        next.delete(issueId);
        return next;
      });
    }
  }

  const releaseMutation = useMutation({
    mutationFn: (issueId: string) =>
      apiClient.delete(`/issues/${issueId}/claim`),
    onSuccess: () => {
      toast.success("Claim released");
      queryClient.invalidateQueries({ queryKey: ["claimed-issues"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submitPRMutation = useMutation({
    mutationFn: ({ reviewId, prType }: { reviewId: string; prType: string }) =>
      apiClient.post<{ id: string; githubPrUrl: string | null; state: string }>("/prs", {
        reviewId,
        idempotencyKey: `dev-${reviewId}-${Date.now()}`,
        disclosureText: "",
        prType: prType === "draft" ? "draft" : "ready_for_review",
      }),
    onSuccess: (data) => {
      if (data.githubPrUrl) {
        toast.success("PR created on GitHub!", {
          action: { label: "View PR", onClick: () => window.open(data.githubPrUrl!, "_blank") },
        });
      } else {
        toast.success("PR submitted successfully");
      }
      queryClient.invalidateQueries({ queryKey: ["jobs-list"] });
      queryClient.invalidateQueries({ queryKey: ["claimed-issues"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const creditBalance = creditData?.balance ?? 0;
  const activeJobs = recentJobs.filter((j) => j.status === "queued" || j.status === "running");

  return (
    <AppShell creditBalance={creditBalance}>
      <div className="space-y-6">
        <div>
          <h1 className="font-mono text-2xl font-bold">
            Welcome back, {user?.username ?? "Developer"}
          </h1>
          <div className="mt-2 flex items-center gap-2">
            {user?.tier && <TierBadge tier={user.tier} />}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            label="CHS Score"
            value={reputationData?.contributionHealthScore ?? "—"}
          />
          <StatsCard
            label="Credits"
            value={creditBalance}
            icon={<Zap className="h-4 w-4" />}
          />
          <StatsCard label="Active Claims" value={claimedIssues.length} />
          <StatsCard label="Running Jobs" value={activeJobs.length} />
        </div>

        {/* Claimed Issues — the main actionable section */}
        <Card>
          <CardHeader>
            <CardTitle>Your Claimed Issues</CardTitle>
            <CardDescription>
              Issues you've claimed. Run the agent to generate a fix, or release the claim.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {claimsLoading ? (
              <div className="h-24 animate-pulse rounded bg-muted" />
            ) : claimedIssues.length === 0 ? (
              <EmptyState
                icon={<Search className="h-6 w-6" />}
                title="No active claims"
                description="Browse recommended issues and claim one to get started"
                action={{
                  label: "Find Issues",
                  onClick: () => navigate("/issues"),
                }}
              />
            ) : (
              <div className="space-y-3">
                {claimedIssues.map((issue) => (
                  <div
                    key={issue.id}
                    className="flex items-start gap-4 rounded-lg border p-4 transition-colors hover:bg-accent/50"
                  >
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/issues/${issue.id}`}
                        className="font-medium hover:underline line-clamp-1"
                      >
                        {issue.title}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{issue.repoFullName}</span>
                        <Badge variant="secondary" className="text-xs">{issue.ecosystem}</Badge>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Claimed {formatTimeAgo(issue.claimedAt)}
                        </span>
                      </div>
                      {issue.latestJobId && (
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Latest job:</span>
                          <Link to={`/jobs/${issue.latestJobId}`} className="inline-flex items-center gap-1">
                            <StatusBadge status={issue.latestJobStatus as "queued" | "running" | "completed" | "failed"} />
                          </Link>
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {issue.latestJobStatus === "approved" && issue.latestReviewId ? (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => submitPRMutation.mutate({
                            reviewId: issue.latestReviewId!,
                            prType: issue.latestReviewPrType ?? "ready_for_review",
                          })}
                          disabled={submitPRMutation.isPending}
                        >
                          <Send className="mr-1.5 h-3.5 w-3.5" />
                          {submitPRMutation.isPending ? "Submitting..." : "Submit PR"}
                        </Button>
                      ) : issue.latestJobStatus === "review_pending" && issue.latestReviewId ? (
                        <Button size="sm" variant="default" className="animate-pulse" asChild>
                          <Link to={`/review/${issue.latestReviewId}`}>
                            <FileCheck className="mr-1.5 h-3.5 w-3.5" />
                            Review & Approve
                          </Link>
                        </Button>
                      ) : issue.latestJobId && (issue.latestJobStatus === "queued" || issue.latestJobStatus === "running") ? (
                        <Button size="sm" variant="outline" asChild>
                          <Link to={`/jobs/${issue.latestJobId}`}>
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            View Job
                          </Link>
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => runAgentForIssue(issue.id)}
                          disabled={runningIssueIds.has(issue.id) || creditBalance < 1}
                          title={creditBalance < 1 ? "Insufficient credits" : "Run the AI agent to generate a fix"}
                        >
                          {runningIssueIds.has(issue.id) ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Play className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          Run Agent
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => releaseMutation.mutate(issue.id)}
                        disabled={releaseMutation.isPending}
                        title="Release this claim"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Jobs */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Recent Jobs</CardTitle>
              <CardDescription>Agent execution history</CardDescription>
            </CardHeader>
            <CardContent>
              {recentJobs.length === 0 ? (
                <EmptyState
                  icon={<Zap className="h-6 w-6" />}
                  title="No jobs yet"
                  description="Jobs appear here after you run the agent on a claimed issue"
                />
              ) : (
                <ul className="space-y-2">
                  {recentJobs.map((job) => (
                    <li key={job.id} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-accent/50">
                      <Link
                        to={`/jobs/${job.id}`}
                        className="flex items-center gap-2 text-sm hover:underline"
                      >
                        <span className="font-mono text-muted-foreground">{job.id.slice(0, 8)}</span>
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                      <div className="flex items-center gap-3">
                        {job.confidenceScore !== null && (
                          <span className="text-xs text-muted-foreground">
                            {Math.round(job.confidenceScore)}% confidence
                          </span>
                        )}
                        <StatusBadge status={job.status} />
                        {job.status === "review_pending" && job.reviewId && (
                          <Button
                            size="sm"
                            variant="default"
                            className="h-6 px-2 text-xs"
                            asChild
                          >
                            <Link to={`/review/${job.reviewId}`}>
                              <FileCheck className="mr-1 h-3 w-3" />
                              Review
                            </Link>
                          </Button>
                        )}
                        {job.status === "approved" && job.reviewId && (
                          <Button
                            size="sm"
                            variant="default"
                            className="h-6 px-2 text-xs"
                            onClick={(e) => {
                              e.preventDefault();
                              submitPRMutation.mutate({
                                reviewId: job.reviewId!,
                                prType: job.reviewPrType ?? "ready_for_review",
                              });
                            }}
                            disabled={submitPRMutation.isPending}
                          >
                            <Send className="mr-1 h-3 w-3" />
                            {submitPRMutation.isPending ? "..." : "Submit PR"}
                          </Button>
                        )}
                        {job.status === "submitted" && (
                          <span className="flex items-center gap-1 text-xs text-green-600">
                            <CheckCircle2 className="h-3 w-3" />
                            PR Created
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Navigate to key areas</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">LLM Provider for Jobs</p>
                <ProviderSelector value={selectedProvider} onChange={setSelectedProvider} />
              </div>
              <Button asChild className="w-full justify-start">
                <Link to="/issues">
                  <Search className="mr-2 h-4 w-4" />
                  Find Issues
                </Link>
              </Button>
              <Button variant="outline" asChild className="w-full justify-start">
                <Link to="/inbox">
                  <Inbox className="mr-2 h-4 w-4" />
                  Check Inbox
                </Link>
              </Button>
              <Button variant="outline" asChild className="w-full justify-start">
                <Link to="/settings/profile">
                  <Zap className="mr-2 h-4 w-4" />
                  Update Tech Stack
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

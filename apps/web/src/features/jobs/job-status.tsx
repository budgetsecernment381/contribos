import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileCheck, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/shared/status-badge";
import { StepWizard } from "@/components/shared/step-wizard";
import { DiffViewer } from "@/components/shared/diff-viewer";
import { CodeBlock } from "@/components/shared/code-block";
import { apiClient } from "@/lib/api";

interface JobDetail {
  id: string;
  status:
    | "queued"
    | "running"
    | "completed"
    | "review_pending"
    | "failed"
    | "approved"
    | "submitted"
    | "rejected";
  confidenceScore?: number | null;
  diffLinesChanged?: number | null;
  diff?: string | null;
  summary?: string | null;
  executionTrace?: string | null;
  reviewId?: string | null;
  artifact?: string;
  gateResults?: { gate: string; pass: boolean; reason?: string }[];
  failureReason?: string | null;
}

const JOB_STEPS = [
  { id: "queued", label: "Queued" },
  { id: "running", label: "Running" },
  { id: "analysis", label: "Analysis" },
  { id: "review", label: "Review" },
];

function stepIndex(status: string): number {
  switch (status) {
    case "queued": return 0;
    case "running": return 1;
    case "failed": return 2;
    case "review_pending": return 3;
    case "approved":
    case "submitted":
    case "completed": return 4;
    default: return 0;
  }
}

export function JobStatus() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const { data: job, isLoading, isError, error } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => apiClient.get<JobDetail>(`/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "queued" || status === "running") return 3000;
      if (status === "review_pending" || status === "approved" || status === "completed") return 5000;
      return false;
    },
  });

  if (isLoading) {
    return (
      <AppShell>
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </AppShell>
    );
  }

  if (isError || !job) {
    return (
      <AppShell>
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12">
              <XCircle className="h-12 w-12 text-destructive" />
              <div className="text-center">
                <h3 className="font-semibold">Failed to load job</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {error instanceof Error ? error.message : "Job not found or an unexpected error occurred."}
                </p>
              </div>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Retry
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  const currentStep = stepIndex(job.status);
  const diffText = job.diff || job.artifact || null;

  return (
    <AppShell>
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Job {job.id.slice(0, 8)}...</CardTitle>
                <CardDescription>Pipeline execution status</CardDescription>
              </div>
              <StatusBadge status={job.status} />
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <StepWizard steps={JOB_STEPS} currentStep={currentStep} />

            {/* Review Pending: success banner + action */}
            {job.status === "review_pending" && (
              <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-600 shrink-0" />
                  <div className="flex-1">
                    <h4 className="font-semibold text-green-700">Fix generated successfully</h4>
                    <p className="mt-1 text-sm text-muted-foreground">
                      The agent produced a fix with <strong>{Math.round(job.confidenceScore ?? 0)}% confidence</strong>
                      {job.diffLinesChanged != null && <> across <strong>{job.diffLinesChanged} file(s)</strong></>}.
                      Review the diff below, then proceed to the review gate to approve or reject it.
                    </p>
                    {job.reviewId && (
                      <Button size="sm" className="mt-3" asChild>
                        <Link to={`/review/${job.reviewId}`}>
                          <FileCheck className="mr-1.5 h-4 w-4" />
                          Start Review
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Approved banner */}
            {job.status === "approved" && (
              <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <p className="text-sm font-medium text-green-700">Review approved. PR submission pending.</p>
                </div>
              </div>
            )}

            {/* Rejected banner */}
            {job.status === "rejected" && (
              <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-orange-600" />
                  <p className="text-sm font-medium text-orange-700">Fix was rejected during review.</p>
                </div>
              </div>
            )}

            {/* Failed banner */}
            {job.status === "failed" && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-start gap-2">
                  <XCircle className="mt-0.5 h-5 w-5 text-destructive shrink-0" />
                  <div>
                    <h4 className="font-mono text-sm font-semibold text-destructive">
                      Execution failed
                    </h4>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {job.failureReason ?? "No failure reason was captured for this run."}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Summary */}
            {job.summary && (
              <div>
                <h4 className="font-mono text-sm font-semibold">Summary</h4>
                <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{job.summary}</p>
              </div>
            )}

            {/* Confidence & Stats */}
            {job.confidenceScore != null && job.confidenceScore > 0 && (
              <div className="flex gap-4">
                <div className="rounded-md border px-3 py-2">
                  <span className="text-xs text-muted-foreground">Confidence</span>
                  <p className="text-lg font-bold">{Math.round(job.confidenceScore)}%</p>
                </div>
                {job.diffLinesChanged != null && (
                  <div className="rounded-md border px-3 py-2">
                    <span className="text-xs text-muted-foreground">Files Changed</span>
                    <p className="text-lg font-bold">{job.diffLinesChanged}</p>
                  </div>
                )}
              </div>
            )}

            {job.gateResults && job.gateResults.length > 0 && (
              <div>
                <h4 className="font-mono text-sm font-semibold">Gate Results</h4>
                <ul className="mt-2 space-y-2">
                  {job.gateResults.map((g) => (
                    <li
                      key={g.gate}
                      className={`flex items-center gap-2 rounded-sm px-2 py-1 text-sm ${
                        g.pass ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      {g.gate}: {g.pass ? "Pass" : "Fail"}
                      {g.reason && ` — ${g.reason}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Diff Viewer */}
            {diffText && (
              <div>
                <h4 className="font-mono text-sm font-semibold">Generated Diff</h4>
                <div className="mt-2 max-h-[600px] overflow-auto rounded-lg border">
                  {diffText.includes("---") || diffText.includes("diff") ? (
                    <DiffViewer diff={diffText} />
                  ) : (
                    <CodeBlock code={diffText} />
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

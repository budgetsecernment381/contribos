import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppShell } from "@/components/layout/app-shell";
import { apiClient } from "@/lib/api";
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Timer,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";

interface JobStatus {
  name: string;
  description: string;
  intervalMs: number;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastStatus: "success" | "error" | "never_run";
  lastError: string | null;
  lastResult: Record<string, unknown> | null;
  running: boolean;
  runCount: number;
}

interface DbStats {
  issues: Record<string, number>;
  issuesByEcosystem: Record<string, number>;
  repos: Record<string, number>;
  totalUsers: number;
}

function formatInterval(ms: number): string {
  if (ms >= 86_400_000) return `${ms / 86_400_000}h`;
  if (ms >= 3_600_000) return `${ms / 3_600_000}h`;
  if (ms >= 60_000) return `${ms / 60_000}m`;
  return `${ms / 1000}s`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function friendlyName(name: string): string {
  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function friendlyKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .replace(/_/g, " ")
    .trim();
}

function StatusIcon({ status, running }: { status: JobStatus["lastStatus"]; running: boolean }) {
  if (running) return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
  if (status === "success") return <CheckCircle2 className="h-5 w-5 text-green-500" />;
  if (status === "error") return <XCircle className="h-5 w-5 text-red-500" />;
  return <Clock className="h-5 w-5 text-muted-foreground" />;
}

function StatusBadge({ status, running }: { status: JobStatus["lastStatus"]; running: boolean }) {
  if (running) {
    return (
      <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
        Running
      </Badge>
    );
  }
  if (status === "success") {
    return (
      <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        Success
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
        Error
      </Badge>
    );
  }
  return <Badge variant="secondary">Pending</Badge>;
}

function ResultPanel({ result }: { result: Record<string, unknown> | null }) {
  if (!result) return null;

  const entries = Object.entries(result);
  if (entries.length === 0) return null;

  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm">
      <div className="grid gap-2">
        {entries.map(([key, value]) => {
          if (key === "sampleErrors" && Array.isArray(value)) {
            return (
              <div key={key}>
                <span className="text-xs font-medium text-muted-foreground">
                  Sample Errors
                </span>
                <div className="mt-1 space-y-1">
                  {(value as string[]).map((err, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400"
                    >
                      <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="break-all">{err}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          const displayValue =
            typeof value === "number"
              ? value.toLocaleString()
              : String(value ?? "—");

          const isHighlight =
            key === "issuesFetched" ||
            key === "issuesUpserted" ||
            key === "newReposInserted" ||
            key === "totalDiscovered" ||
            key === "totalRepos";

          return (
            <div key={key} className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {friendlyKey(key)}
              </span>
              <span
                className={`font-mono text-xs ${
                  isHighlight ? "font-semibold text-foreground" : "text-foreground/80"
                }`}
              >
                {displayValue}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function JobCard({
  job,
  onTrigger,
  isMutating,
}: {
  job: JobStatus;
  onTrigger: (name: string) => void;
  isMutating: boolean;
}) {
  const [expanded, setExpanded] = useState(
    job.lastResult !== null && job.lastStatus !== "never_run"
  );

  const hasResult = job.lastResult !== null;

  return (
    <Card className={job.running ? "ring-2 ring-blue-400/50" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <StatusIcon status={job.lastStatus} running={job.running} />
            <CardTitle className="text-base">{friendlyName(job.name)}</CardTitle>
          </div>
          <StatusBadge status={job.lastStatus} running={job.running} />
        </div>
        <CardDescription>{job.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Interval</div>
            <div className="font-mono font-medium">
              {formatInterval(job.intervalMs)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Last Run</div>
            <div className="font-medium">{formatTimeAgo(job.lastRunAt)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Duration</div>
            <div className="font-mono font-medium">
              {formatDuration(job.lastDurationMs)}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Timer className="h-3.5 w-3.5" />
            {job.runCount} total run{job.runCount !== 1 ? "s" : ""}
          </div>
          <div className="flex items-center gap-1.5">
            {hasResult && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                <span className="ml-1 text-xs">
                  {expanded ? "Hide" : "Results"}
                </span>
              </Button>
            )}
            <Button
              size="sm"
              variant={job.running ? "outline" : "default"}
              disabled={job.running || isMutating}
              onClick={() => onTrigger(job.name)}
            >
              {job.running ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="mr-1 h-3.5 w-3.5" />
                  Run Now
                </>
              )}
            </Button>
          </div>
        </div>

        {job.lastStatus === "error" && job.lastError && (
          <div className="flex items-start gap-2 rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="break-all">{job.lastError}</span>
          </div>
        )}

        {expanded && hasResult && <ResultPanel result={job.lastResult} />}
      </CardContent>
    </Card>
  );
}

function DbStatsPanel({ stats }: { stats: DbStats }) {
  const totalIssues = Object.values(stats.issues).reduce((a, b) => a + b, 0);
  const totalRepos = Object.values(stats.repos).reduce((a, b) => a + b, 0);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Issues by Status
          </CardTitle>
          <CardDescription className="text-2xl font-bold text-foreground">
            {totalIssues.toLocaleString()} total
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(stats.issues).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between text-sm">
                <span className="capitalize">{status}</span>
                <span className="font-mono font-medium">{count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Available Issues by Ecosystem
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(stats.issuesByEcosystem).map(([eco, count]) => {
              const pct = totalIssues > 0 ? Math.round((count / totalIssues) * 100) : 0;
              return (
                <div key={eco} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="capitalize">{eco}</span>
                    <span className="font-mono font-medium">
                      {count.toLocaleString()}
                      <span className="ml-1 text-xs text-muted-foreground">{pct}%</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            System Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>Total Repos</span>
              <span className="font-mono font-bold">{totalRepos}</span>
            </div>
            {Object.entries(stats.repos).map(([state, count]) => (
              <div key={state} className="flex items-center justify-between text-sm pl-3">
                <span className="capitalize text-muted-foreground">{state}</span>
                <span className="font-mono">{count}</span>
              </div>
            ))}
            <div className="border-t pt-2 flex items-center justify-between text-sm">
              <span>Total Users</span>
              <span className="font-mono font-bold">{stats.totalUsers}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function AdminScheduler() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-scheduler"],
    queryFn: () =>
      apiClient.get<{ jobs: JobStatus[]; dbStats: DbStats }>("/admin/scheduler/status"),
    refetchInterval: 5000,
  });

  const triggerMutation = useMutation({
    mutationFn: (jobName: string) =>
      apiClient.post(`/admin/scheduler/trigger/${jobName}`),
    onSuccess: (_, jobName) => {
      toast.success(`${friendlyName(jobName)} triggered`);
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["admin-scheduler"] });
      }, 1000);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const jobs = data?.jobs ?? [];
  const dbStats = data?.dbStats ?? null;

  const successCount = jobs.filter((j) => j.lastStatus === "success").length;
  const errorCount = jobs.filter((j) => j.lastStatus === "error").length;
  const runningCount = jobs.filter((j) => j.running).length;
  const neverRunCount = jobs.filter((j) => j.lastStatus === "never_run").length;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-mono text-2xl font-bold">Scheduler</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Monitor background jobs, trigger manually, and view system stats.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ["admin-scheduler"] })
            }
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {/* DB Stats */}
        {dbStats && <DbStatsPanel stats={dbStats} />}

        {/* Job status summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="flex items-center gap-3 pt-4 pb-4">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <div>
                <div className="text-2xl font-bold">{successCount}</div>
                <div className="text-xs text-muted-foreground">Succeeded</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 pt-4 pb-4">
              <XCircle className="h-5 w-5 text-red-500" />
              <div>
                <div className="text-2xl font-bold">{errorCount}</div>
                <div className="text-xs text-muted-foreground">Failed</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 pt-4 pb-4">
              <Loader2 className="h-5 w-5 text-blue-500" />
              <div>
                <div className="text-2xl font-bold">{runningCount}</div>
                <div className="text-xs text-muted-foreground">Running</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 pt-4 pb-4">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold">{neverRunCount}</div>
                <div className="text-xs text-muted-foreground">Never Run</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Job cards */}
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {jobs.map((job) => (
              <JobCard
                key={job.name}
                job={job}
                onTrigger={(name) => triggerMutation.mutate(name)}
                isMutating={triggerMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

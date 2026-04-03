import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "review_pending"
  | "approved"
  | "submitted"
  | "rejected"
  | "failed"
  | "cancelled";

export type PRStatus = "open" | "merged" | "closed" | "abandoned";

export type ReviewStatus = "pending" | "passed" | "failed";

const JOB_STATUS_CONFIG: Record<
  JobStatus,
  { variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info"; label: string; pulse?: boolean }
> = {
  queued: { variant: "secondary", label: "Queued" },
  running: { variant: "info", label: "Running", pulse: true },
  completed: { variant: "success", label: "Completed" },
  review_pending: { variant: "warning", label: "Review Pending" },
  approved: { variant: "success", label: "Approved" },
  submitted: { variant: "info", label: "Submitted" },
  rejected: { variant: "destructive", label: "Rejected" },
  failed: { variant: "destructive", label: "Failed" },
  cancelled: { variant: "outline", label: "Cancelled" },
};

const PR_STATUS_CONFIG: Record<
  PRStatus,
  { variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info"; label: string; pulse?: boolean }
> = {
  open: { variant: "info", label: "Open" },
  merged: { variant: "success", label: "Merged" },
  closed: { variant: "secondary", label: "Closed" },
  abandoned: { variant: "destructive", label: "Abandoned" },
};

const REVIEW_STATUS_CONFIG: Record<
  ReviewStatus,
  { variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info"; label: string; pulse?: boolean }
> = {
  pending: { variant: "warning", label: "Pending" },
  passed: { variant: "success", label: "Passed" },
  failed: { variant: "destructive", label: "Failed" },
};

interface StatusBadgeProps {
  status: JobStatus | PRStatus | ReviewStatus;
  type?: "job" | "pr" | "review";
  className?: string;
}

export function StatusBadge({ status, type = "job", className }: StatusBadgeProps) {
  const config =
    type === "job"
      ? JOB_STATUS_CONFIG[status as JobStatus]
      : type === "pr"
        ? PR_STATUS_CONFIG[status as PRStatus]
        : REVIEW_STATUS_CONFIG[status as ReviewStatus];

  if (!config) return null;

  return (
    <Badge
      variant={config.variant}
      className={cn(
        config.pulse && "animate-pulse-subtle",
        className
      )}
    >
      {config.pulse && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
      {config.label}
    </Badge>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { apiClient } from "@/lib/api";
import { MessageSquare, GitPullRequest } from "lucide-react";

interface PR {
  id: string;
  githubPrUrl: string | null;
  state: "open" | "merged" | "closed" | "abandoned";
  createdAt: string;
}

function formatTimeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export function PRFeed() {
  const [stateFilter, setStateFilter] = useState("all");

  const { data: prs = [], isLoading } = useQuery({
    queryKey: ["prs", stateFilter],
    queryFn: () =>
      apiClient.get<PR[]>("/prs").catch(() => []),
  });

  const filtered =
    stateFilter === "all"
      ? prs
      : prs.filter((p) => p.state === stateFilter);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="font-mono text-2xl font-bold">PR Activity</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All your pull requests and their status
          </p>
        </div>

        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Filter by state" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="merged">Merged</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="abandoned">Abandoned</SelectItem>
          </SelectContent>
        </Select>

        {isLoading ? (
          <div className="h-64 animate-pulse rounded-lg bg-muted" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<GitPullRequest className="h-6 w-6" />}
            title="No PRs yet"
            description="Your submitted PRs will appear here"
            action={{
              label: "Check Inbox",
              onClick: () => (window.location.href = "/inbox"),
            }}
          />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PR</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Activity</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((pr) => (
                  <TableRow key={pr.id}>
                    <TableCell>
                      <div>
                        {pr.githubPrUrl ? (
                          <a href={pr.githubPrUrl} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                            PR #{pr.id.slice(0, 8)}
                          </a>
                        ) : (
                          <span className="font-medium">PR #{pr.id.slice(0, 8)}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={pr.state} type="pr" />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatTimeAgo(pr.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Link to="/inbox">
                        <MessageSquare className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppShell>
  );
}

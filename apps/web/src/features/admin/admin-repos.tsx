import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { AppShell } from "@/components/layout/app-shell";
import { apiClient } from "@/lib/api";
import {
  Check,
  X,
  RefreshCw,
  Search,
  Star,
  CheckCheck,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

interface Repo {
  id: string;
  fullName: string;
  description?: string | null;
  ecosystem: string;
  allowlistState: string;
  prestigeTier: string;
  starCount?: number;
  language?: string | null;
  lastSyncedAt?: string | null;
}

type TabFilter = "all" | "pending" | "approved" | "rejected";

const STATE_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

function formatStars(count: number | undefined): string {
  if (!count) return "—";
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

export function AdminRepos() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabFilter>("pending");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: repos = [], isLoading } = useQuery({
    queryKey: ["admin-repos"],
    queryFn: () => apiClient.get<Repo[]>("/admin/repos").catch(() => []),
  });

  const approveMutation = useMutation({
    mutationFn: (repoId: string) =>
      apiClient.patch(`/admin/repos/${repoId}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-repos"] });
      toast.success("Repository approved — issue sync enqueued");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: (repoId: string) =>
      apiClient.patch(`/admin/repos/${repoId}/reject`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-repos"] });
      toast.success("Repository rejected");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const syncMutation = useMutation({
    mutationFn: (repoId: string) =>
      apiClient.post(`/admin/repos/${repoId}/sync`),
    onSuccess: () => toast.success("Sync job enqueued"),
    onError: (e: Error) => toast.error(e.message),
  });

  const [bulkLoading, setBulkLoading] = useState(false);

  async function bulkApprove() {
    if (selected.size === 0) return;
    setBulkLoading(true);
    let success = 0;
    let failed = 0;
    for (const repoId of selected) {
      try {
        await apiClient.patch(`/admin/repos/${repoId}/approve`);
        success++;
      } catch {
        failed++;
      }
    }
    setBulkLoading(false);
    setSelected(new Set());
    queryClient.invalidateQueries({ queryKey: ["admin-repos"] });
    toast.success(
      `Approved ${success} repo${success !== 1 ? "s" : ""}${failed > 0 ? `, ${failed} failed` : ""} — sync enqueued`
    );
  }

  const filtered = useMemo(() => {
    let list = repos;
    if (tab !== "all") {
      list = list.filter((r) => r.allowlistState === tab);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.fullName.toLowerCase().includes(q) ||
          r.ecosystem.toLowerCase().includes(q) ||
          (r.description ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [repos, tab, search]);

  const pendingFiltered = useMemo(
    () => filtered.filter((r) => r.allowlistState === "pending"),
    [filtered]
  );

  const counts = useMemo(() => {
    const c = { all: repos.length, pending: 0, approved: 0, rejected: 0 };
    for (const r of repos) {
      if (r.allowlistState === "pending") c.pending++;
      else if (r.allowlistState === "approved") c.approved++;
      else if (r.allowlistState === "rejected") c.rejected++;
    }
    return c;
  }, [repos]);

  const allPendingSelected =
    pendingFiltered.length > 0 &&
    pendingFiltered.every((r) => selected.has(r.id));

  function toggleSelectAll() {
    if (allPendingSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pendingFiltered.map((r) => r.id)));
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const tabs: { key: TabFilter; label: string; count: number }[] = [
    { key: "pending", label: "Pending", count: counts.pending },
    { key: "approved", label: "Approved", count: counts.approved },
    { key: "rejected", label: "Rejected", count: counts.rejected },
    { key: "all", label: "All", count: counts.all },
  ];

  const isMutating =
    approveMutation.isPending ||
    rejectMutation.isPending ||
    syncMutation.isPending ||
    bulkLoading;

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="font-mono text-2xl font-bold">Repositories</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage discovered and nominated repositories. Approve repos to start syncing issues.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((t) => (
            <Button
              key={t.key}
              variant={tab === t.key ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setTab(t.key);
                setSelected(new Set());
              }}
            >
              {t.label}
              <Badge
                variant="secondary"
                className="ml-1.5 px-1.5 py-0 text-xs"
              >
                {t.count}
              </Badge>
            </Button>
          ))}
        </div>

        {/* Search + Bulk actions */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search repos, ecosystems…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {selected.size > 0 && (
            <Button
              size="sm"
              onClick={bulkApprove}
              disabled={bulkLoading}
            >
              {bulkLoading ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <CheckCheck className="mr-1.5 h-4 w-4" />
              )}
              Approve {selected.size} selected
            </Button>
          )}
        </div>

        {/* Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {tab === "all" ? "All Repositories" : `${tab.charAt(0).toUpperCase() + tab.slice(1)} Repositories`}
            </CardTitle>
            <CardDescription>
              {filtered.length} repositor{filtered.length !== 1 ? "ies" : "y"}
              {search && ` matching "${search}"`}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                {search ? "No repos match your search" : `No ${tab === "all" ? "" : tab} repositories`}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {(tab === "pending" || tab === "all") && (
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allPendingSelected}
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all pending"
                        />
                      </TableHead>
                    )}
                    <TableHead>Repository</TableHead>
                    <TableHead className="hidden sm:table-cell">Ecosystem</TableHead>
                    <TableHead className="hidden md:table-cell">
                      <Star className="inline h-3.5 w-3.5" /> Stars
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow
                      key={r.id}
                      data-state={selected.has(r.id) ? "selected" : undefined}
                    >
                      {(tab === "pending" || tab === "all") && (
                        <TableCell>
                          {r.allowlistState === "pending" ? (
                            <Checkbox
                              checked={selected.has(r.id)}
                              onCheckedChange={() => toggleSelect(r.id)}
                              aria-label={`Select ${r.fullName}`}
                            />
                          ) : (
                            <span />
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <a
                            href={`https://github.com/${r.fullName}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-sm font-medium hover:underline"
                          >
                            {r.fullName}
                          </a>
                          {r.description && (
                            <span className="line-clamp-1 text-xs text-muted-foreground">
                              {r.description}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="outline" className="text-xs">
                          {r.ecosystem}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell font-mono text-sm">
                        {formatStars(r.starCount)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            STATE_COLORS[r.allowlistState] ?? ""
                          }`}
                        >
                          {r.allowlistState}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {r.allowlistState === "pending" && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-green-600 hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-950"
                                onClick={() => approveMutation.mutate(r.id)}
                                disabled={isMutating}
                                title="Approve"
                              >
                                <Check className="h-4 w-4" />
                                <span className="hidden lg:inline ml-1">Approve</span>
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
                                onClick={() => rejectMutation.mutate(r.id)}
                                disabled={isMutating}
                                title="Reject"
                              >
                                <X className="h-4 w-4" />
                                <span className="hidden lg:inline ml-1">Reject</span>
                              </Button>
                            </>
                          )}
                          {r.allowlistState === "approved" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7"
                              onClick={() => syncMutation.mutate(r.id)}
                              disabled={isMutating}
                              title="Trigger sync"
                            >
                              <RefreshCw className="h-4 w-4" />
                              <span className="hidden lg:inline ml-1">Sync</span>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

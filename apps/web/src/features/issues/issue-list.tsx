import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/layout/app-shell";
import { TierBadge } from "@/components/shared/tier-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { apiClient } from "@/lib/api";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";

interface Issue {
  id: string;
  title: string;
  repoFullName: string;
  compositeScore: number;
  minimumTier: number;
  claimStatus: string;
  ecosystem: string;
  fixabilityScore: number;
  reputationValueScore: number;
}

interface PaginatedResponse {
  issues: Issue[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function IssueList() {
  const [sort, setSort] = useState("score");
  const [ecosystem, setEcosystem] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounce(search, 300);

  const buildQuery = () => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "20");
    if (sort !== "score") params.set("sort", sort);
    if (ecosystem !== "all") params.set("ecosystem", ecosystem);
    if (debouncedSearch) params.set("search", debouncedSearch);
    return `/issues/recommended?${params.toString()}`;
  };

  const { data, isLoading } = useQuery({
    queryKey: ["issues", page, sort, ecosystem, debouncedSearch],
    queryFn: () => apiClient.get<PaginatedResponse>(buildQuery()),
    placeholderData: keepPreviousData,
  });

  const { data: ecosystems = [] } = useQuery({
    queryKey: ["ecosystems"],
    queryFn: () => apiClient.get<string[]>("/issues/ecosystems"),
    staleTime: 5 * 60 * 1000,
  });

  const issues = data?.issues ?? [];
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleSortChange = (value: string) => {
    setSort(value);
    setPage(1);
  };

  const handleEcosystemChange = (value: string) => {
    setEcosystem(value);
    setPage(1);
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="font-mono text-2xl font-bold">Recommended Issues</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Issues matched to your skills and goals
          </p>
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search issues or repos..."
              className="pl-9"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>
          <Select value={sort} onValueChange={handleSortChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="score">Score</SelectItem>
              <SelectItem value="prestige">Prestige</SelectItem>
              <SelectItem value="newest">Newest</SelectItem>
            </SelectContent>
          </Select>
          <Select value={ecosystem} onValueChange={handleEcosystemChange}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Ecosystem" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Ecosystems</SelectItem>
              {ecosystems.map((eco) => (
                <SelectItem key={eco} value={eco}>
                  {eco}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading && !data ? (
          <div className="h-64 animate-pulse rounded-lg bg-muted" />
        ) : issues.length === 0 ? (
          <EmptyState
            icon={<Search className="h-6 w-6" />}
            title="No issues found"
            description="Try adjusting your filters or check back later"
          />
        ) : (
          <>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Issue</TableHead>
                    <TableHead>Repo</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Ecosystem</TableHead>
                    <TableHead>Min Tier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issues.map((issue) => (
                    <TableRow key={issue.id}>
                      <TableCell className="font-medium max-w-[300px]">
                        <Link
                          to={`/issues/${issue.id}`}
                          className="hover:underline line-clamp-2"
                        >
                          {issue.title}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {issue.repoFullName}
                      </TableCell>
                      <TableCell>{issue.compositeScore.toFixed(1)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{issue.ecosystem}</Badge>
                      </TableCell>
                      <TableCell>
                        <TierBadge tier={issue.minimumTier as 1 | 2 | 3 | 4} />
                      </TableCell>
                      <TableCell>{issue.claimStatus}</TableCell>
                      <TableCell>
                        <Link to={`/issues/${issue.id}`}>
                          <Badge variant="outline">View</Badge>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * (data?.pageSize ?? 20) + 1}–
                {Math.min(page * (data?.pageSize ?? 20), total)} of {total}{" "}
                issues
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={page <= 1}
                  onClick={() => setPage(1)}
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-3 text-sm tabular-nums">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={page >= totalPages}
                  onClick={() => setPage(totalPages)}
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

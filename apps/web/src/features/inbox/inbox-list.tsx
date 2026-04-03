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
import { Badge } from "@/components/ui/badge";
import { AppShell } from "@/components/layout/app-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { apiClient } from "@/lib/api";
import { Inbox } from "lucide-react";

interface InboxItem {
  id: string;
  commentType: string;
  paraphrase: string;
  isAcknowledged: boolean;
  createdAt: string;
  reminder48hSent?: boolean;
  chsRisk5dFlagged?: boolean;
}

export function InboxList() {
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["inbox"],
    queryFn: () => apiClient.get<InboxItem[]>("/inbox").catch(() => []),
  });

  const typeLabels: Record<string, string> = {
    question: "Question",
    change_request: "Change Request",
    approval: "Approval",
    clarification: "Clarification",
    merge_feedback: "Merge Feedback",
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="font-mono text-2xl font-bold">Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Maintainer feedback and activity requiring your attention
          </p>
        </div>

        {isLoading ? (
          <div className="h-64 animate-pulse rounded-lg bg-muted" />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-6 w-6" />}
            title="Inbox empty"
            description="You're all caught up. New maintainer feedback will appear here."
          />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Urgency</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Badge variant="outline">{typeLabels[item.commentType] ?? item.commentType}</Badge>
                    </TableCell>
                    <TableCell>
                      <Link to={`/inbox/${item.id}`} className="font-medium hover:underline">
                        {item.paraphrase}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {item.chsRisk5dFlagged && (
                        <Badge variant="destructive">CHS Risk</Badge>
                      )}
                      {item.reminder48hSent && !item.chsRisk5dFlagged && (
                        <Badge variant="secondary">48h Reminder</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {item.isAcknowledged ? (
                        <Badge variant="secondary">Acknowledged</Badge>
                      ) : (
                        <Badge variant="default">New</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link to={`/inbox/${item.id}`}>
                        <Badge variant="outline">View</Badge>
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

import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppShell } from "@/components/layout/app-shell";
import { apiClient } from "@/lib/api";
import { Zap } from "lucide-react";

interface CreditsData {
  balance: number;
  planTier: "free" | "starter" | "pro";
  transactions?: { id: string; amount: number; transactionType: string; balanceAfter: number; createdAt: string }[];
}

const PLANS = [
  { id: "free", name: "Free", credits: 10, price: "$0" },
  { id: "starter", name: "Starter", credits: 100, price: "$9/mo" },
  { id: "pro", name: "Pro", credits: 500, price: "$29/mo" },
];

export function CreditsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["credits"],
    queryFn: () => apiClient.get<CreditsData>("/credits"),
    placeholderData: { balance: 0, planTier: "free" as const, transactions: [] },
  });

  const balance = data?.balance ?? 0;
  const planTier = data?.planTier ?? "free";
  const transactions = data?.transactions ?? [];

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="font-mono text-2xl font-bold">Credits</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your credit balance and plan
          </p>
          {isError && !isLoading && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              Could not refresh credits. Showing last known or default values.
            </p>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Current Balance
              </CardTitle>
              <CardDescription>Available credits for contributions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-3xl font-bold">{balance}</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Plan: <Badge variant="secondary">{planTier}</Badge>
              </p>
              <Button className="mt-4">Top up</Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Transaction History</CardTitle>
            <CardDescription>Recent credit activity</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-32 animate-pulse rounded bg-muted" />
            ) : transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transactions yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((t: { id: string; amount: number; transactionType: string; createdAt: string }) => (
                    <TableRow key={t.id}>
                      <TableCell>{new Date(t.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell>{t.transactionType}</TableCell>
                      <TableCell className={t.amount >= 0 ? "text-success" : "text-destructive"}>
                        {t.amount >= 0 ? "+" : ""}{t.amount}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plan Comparison</CardTitle>
            <CardDescription>Choose the plan that fits your contribution goals</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              {PLANS.map((plan) => (
                <div
                  key={plan.id}
                  className={`rounded-lg border p-4 ${
                    planTier === plan.id ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <div className="font-mono font-semibold">{plan.name}</div>
                  <div className="mt-2 text-2xl font-bold">{plan.price}</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {plan.credits} credits
                  </div>
                  <Button
                    variant={planTier === plan.id ? "default" : "outline"}
                    className="mt-4 w-full"
                    disabled={planTier === plan.id}
                  >
                    {planTier === plan.id ? "Current" : "Upgrade"}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

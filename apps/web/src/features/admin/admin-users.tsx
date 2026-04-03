import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AppShell } from "@/components/layout/app-shell";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Coins, Plus, Minus, Search } from "lucide-react";

interface AdminUser {
  id: string;
  githubUsername: string;
  email: string | null;
  avatarUrl: string | null;
  role: string;
  tier: number;
  creditBalance: number;
  planTier: string;
  onboardingComplete: boolean;
  createdAt: string;
}

export function AdminUsers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => apiClient.get<AdminUser[]>("/admin/users"),
  });

  const updateCreditsMutation = useMutation({
    mutationFn: ({ userId, amount, reason }: { userId: string; amount: number; reason: string }) =>
      apiClient.post<{ creditBalance: number }>(`/admin/users/${userId}/credits`, { amount, reason }),
    onSuccess: (data) => {
      toast.success(`Credits updated. New balance: ${data.creditBalance}`);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setSelectedUser(null);
      setCreditAmount("");
      setCreditReason("");
    },
  });

  const filtered = users.filter(
    (u) =>
      u.githubUsername.toLowerCase().includes(search.toLowerCase()) ||
      (u.email ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const handleCreditUpdate = (amount: number) => {
    if (!selectedUser || !creditReason.trim()) {
      toast.error("Please provide a reason");
      return;
    }
    updateCreditsMutation.mutate({
      userId: selectedUser.id,
      amount,
      reason: creditReason.trim(),
    });
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="font-mono text-2xl font-bold">Admin: Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage users and their credit balances
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Badge variant="secondary">{filtered.length} users</Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Users</CardTitle>
            <CardDescription>Click the credits badge to adjust a user's balance</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-32 animate-pulse rounded bg-muted" />
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">No users found</p>
            ) : (
              <div className="divide-y">
                {filtered.map((user) => (
                  <div key={user.id} className="flex items-center gap-4 py-3">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={user.avatarUrl ?? undefined} alt={user.githubUsername} />
                      <AvatarFallback>{user.githubUsername.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{user.githubUsername}</span>
                        {user.role === "admin" && (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">admin</Badge>
                        )}
                        {!user.onboardingComplete && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">pending onboarding</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-muted-foreground">
                          Tier {user.tier}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {user.planTier}
                        </span>
                        {user.email && (
                          <span className="text-xs text-muted-foreground truncate">
                            {user.email}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 shrink-0"
                      onClick={() => {
                        setSelectedUser(user);
                        setCreditAmount("");
                        setCreditReason("");
                      }}
                    >
                      <Coins className="h-3.5 w-3.5" />
                      <span className="font-mono">{user.creditBalance}</span>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={!!selectedUser} onOpenChange={(open) => !open && setSelectedUser(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Coins className="h-5 w-5" />
                Update Credits: {selectedUser?.githubUsername}
              </DialogTitle>
              <DialogDescription>
                Current balance: <span className="font-mono font-bold">{selectedUser?.creditBalance}</span> credits.
                Use positive numbers to add, negative to deduct.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <label className="text-sm font-medium">Amount</label>
                <div className="flex gap-2 mt-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setCreditAmount("5")}
                  >
                    <Plus className="h-3 w-3 mr-1" />5
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setCreditAmount("10")}
                  >
                    <Plus className="h-3 w-3 mr-1" />10
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setCreditAmount("25")}
                  >
                    <Plus className="h-3 w-3 mr-1" />25
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setCreditAmount("-5")}
                  >
                    <Minus className="h-3 w-3 mr-1" />5
                  </Button>
                </div>
                <Input
                  type="number"
                  placeholder="Custom amount (e.g. 10 or -3)"
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                  className="mt-2"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Reason</label>
                <Input
                  placeholder="e.g. Bonus for contribution, refund for failed job..."
                  value={creditReason}
                  onChange={(e) => setCreditReason(e.target.value)}
                  className="mt-1.5"
                />
              </div>
              {creditAmount && selectedUser && (
                <p className="text-sm text-muted-foreground">
                  New balance will be:{" "}
                  <span className="font-mono font-bold">
                    {selectedUser.creditBalance + (parseInt(creditAmount) || 0)}
                  </span>
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedUser(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => handleCreditUpdate(parseInt(creditAmount) || 0)}
                disabled={!creditAmount || parseInt(creditAmount) === 0 || !creditReason.trim() || updateCreditsMutation.isPending}
              >
                {updateCreditsMutation.isPending ? "Updating..." : "Update Credits"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}

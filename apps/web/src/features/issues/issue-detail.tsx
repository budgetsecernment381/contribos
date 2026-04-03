import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TierBadge } from "@/components/shared/tier-badge";
import { AppShell } from "@/components/layout/app-shell";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { apiClient } from "@/lib/api";

const claimSchema = z.object({
  familiarity: z.string().min(1),
  fixIntent: z.string().min(1),
  freeContext: z.string().optional(),
});

type ClaimForm = z.infer<typeof claimSchema>;

interface IssueDetail {
  id: string;
  title: string;
  repoFullName: string;
  compositeScore: number;
  minimumTier: number;
  claimStatus: string;
  complexityEstimate: string | null;
  ecosystem: string;
}

export function IssueDetail() {
  const { issueId } = useParams<{ issueId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: issue, isLoading } = useQuery({
    queryKey: ["issue", issueId],
    queryFn: () => apiClient.get<IssueDetail>(`/issues/${issueId}`),
    enabled: !!issueId,
  });

  const claimMutation = useMutation({
    mutationFn: (body: ClaimForm) =>
      apiClient.post(`/issues/${issueId}/claim`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["issues"] });
      navigate("/dashboard");
    },
  });

  const form = useForm<ClaimForm>({
    resolver: zodResolver(claimSchema),
    defaultValues: { familiarity: "", fixIntent: "", freeContext: "" },
  });

  if (isLoading || !issue) {
    return (
      <AppShell>
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>{issue.title}</CardTitle>
                <CardDescription className="font-mono">{issue.repoFullName}</CardDescription>
              </div>
              <div className="flex gap-2">
                <TierBadge tier={issue.minimumTier as 1 | 2 | 3 | 4} />
                <span className="text-sm text-muted-foreground">
                  Score: {issue.compositeScore.toFixed(1)}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {issue.complexityEstimate && (
              <div>
                <h4 className="font-mono text-sm font-semibold">Complexity</h4>
                <p className="mt-1 text-sm text-muted-foreground">{issue.complexityEstimate}</p>
              </div>
            )}

            {issue.claimStatus === "available" && (
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit((data) => claimMutation.mutate(data))}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="familiarity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Familiarity with codebase</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. First time contributor" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="fixIntent"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Fix intent</FormLabel>
                        <FormControl>
                          <Input placeholder="How you plan to fix this" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="freeContext"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Additional context (optional)</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Any other context..." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" disabled={claimMutation.isPending}>
                    {claimMutation.isPending ? "Claiming..." : "Claim Issue"}
                  </Button>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

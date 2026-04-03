import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const policySchema = z.object({
  maxClaimsPerUser: z.coerce.number().min(1),
  reviewTimeoutHours: z.coerce.number().min(1),
  minTierForPrestige: z.coerce.number().min(1).max(4),
});

type PolicyForm = z.infer<typeof policySchema>;

export function AdminPolicy() {
  const queryClient = useQueryClient();

  const { data: policy } = useQuery({
    queryKey: ["admin-policy"],
    queryFn: () =>
      apiClient.get<PolicyForm>("/admin/policy").catch(() => ({
        maxClaimsPerUser: 5,
        reviewTimeoutHours: 48,
        minTierForPrestige: 1,
      })),
  });

  const updateMutation = useMutation({
    mutationFn: (body: PolicyForm) => apiClient.put("/admin/policy", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-policy"] });
    },
  });

  const form = useForm<PolicyForm>({
    resolver: zodResolver(policySchema),
    defaultValues: {
      maxClaimsPerUser: 5,
      reviewTimeoutHours: 48,
      minTierForPrestige: 1,
    },
    values: policy,
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="font-mono text-2xl font-bold">Admin: Policy</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure policy parameters
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Policy Parameters</CardTitle>
            <CardDescription>
              Global settings that affect matching, reviews, and limits
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((data) => updateMutation.mutate(data))}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="maxClaimsPerUser"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max claims per user</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="reviewTimeoutHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Review timeout (hours)</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="minTierForPrestige"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Min tier for prestige repos (1-4)</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} max={4} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

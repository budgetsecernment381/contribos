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

const prestigeSchema = z.object({
  repoId: z.string().min(1),
  prestige: z.coerce.number().min(0).max(100),
});

type PrestigeForm = z.infer<typeof prestigeSchema>;

interface Repo {
  id: string;
  owner: string;
  repo: string;
  prestige?: number;
}

export function AdminPrestige() {
  const queryClient = useQueryClient();

  const { data: repos = [] } = useQuery({
    queryKey: ["admin-repos"],
    queryFn: () => apiClient.get<Repo[]>("/admin/repos").catch(() => []),
  });

  const updateMutation = useMutation({
    mutationFn: (body: PrestigeForm) =>
      apiClient.put("/admin/prestige-graph", {
        updates: [{
          repoId: body.repoId,
          prestigeTier: "mid",
          prestigeScore: body.prestige,
        }],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-repos"] });
    },
  });

  const form = useForm<PrestigeForm>({
    resolver: zodResolver(prestigeSchema),
    defaultValues: { repoId: "", prestige: 0 },
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="font-mono text-2xl font-bold">Admin: Prestige</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Edit prestige values for repositories
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Prestige Graph Editor</CardTitle>
            <CardDescription>
              Set prestige scores (0-100) for repos. Higher prestige = more weight in matching.
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
                  name="repoId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Repository</FormLabel>
                      <FormControl>
                        <select
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                          value={field.value}
                          onChange={(e) => field.onChange(e.target.value)}
                        >
                          <option value="">Select repo</option>
                          {repos.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.owner}/{r.repo} (current: {r.prestige ?? 0})
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="prestige"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prestige (0-100)</FormLabel>
                      <FormControl>
                        <Input type="number" min={0} max={100} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Updating..." : "Update"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

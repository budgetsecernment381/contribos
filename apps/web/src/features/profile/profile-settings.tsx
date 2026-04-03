import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AppShell } from "@/components/layout/app-shell";
import { EcosystemPicker } from "@/components/shared/ecosystem-picker";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { useState, useEffect } from "react";

const settingsSchema = z.object({
  shareableSlug: z.string().min(1).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  headline: z.string().optional(),
  bio: z.string().optional(),
  visibility: z.enum(["public", "private", "link_only"]),
});

type SettingsForm = z.infer<typeof settingsSchema>;

export function ProfileSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ["profile-settings"],
    queryFn: () => apiClient.get<SettingsForm>("/profile/settings"),
  });

  const { data: ecosystemData } = useQuery({
    queryKey: ["profile-ecosystems"],
    queryFn: () => apiClient.get<{ ecosystems: string[] }>("/profile/ecosystems"),
  });

  const [selectedEcosystems, setSelectedEcosystems] = useState<string[]>([]);

  useEffect(() => {
    if (ecosystemData?.ecosystems) {
      setSelectedEcosystems(ecosystemData.ecosystems);
    }
  }, [ecosystemData]);

  const ecosystemMutation = useMutation({
    mutationFn: (ecosystems: string[]) =>
      apiClient.put("/profile/ecosystems", { ecosystems }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile-ecosystems"] });
      toast.success("Ecosystems updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: (body: SettingsForm) => apiClient.patch("/profile/settings", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile-settings"] });
      toast.success("Profile updated");
    },
  });

  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      shareableSlug: profile?.shareableSlug ?? user?.username?.toLowerCase().replaceAll(/\s/g, "-") ?? "",
      headline: profile?.headline ?? "",
      bio: profile?.bio ?? "",
      visibility: profile?.visibility ?? "public",
    },
    values: profile
      ? {
          shareableSlug: profile.shareableSlug,
          headline: profile.headline ?? "",
          bio: profile.bio ?? "",
          visibility: profile.visibility,
        }
      : undefined,
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <h1 className="font-mono text-2xl font-bold">Profile Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your profile, tech stack, and visibility
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Tech Stack / Languages</CardTitle>
            <CardDescription>
              Select ecosystems or type your own. Issues are filtered based on your selections.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <EcosystemPicker
              selected={selectedEcosystems}
              onChange={setSelectedEcosystems}
            />
            <Button
              onClick={() => ecosystemMutation.mutate(selectedEcosystems)}
              disabled={ecosystemMutation.isPending || selectedEcosystems.length === 0}
            >
              {ecosystemMutation.isPending ? "Saving..." : "Save Ecosystems"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              Your profile is visible at /profile/{form.watch("shareableSlug") || "your-slug"}
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
                  name="shareableSlug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Profile slug</FormLabel>
                      <FormControl>
                        <Input placeholder="your-username" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="headline"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Headline</FormLabel>
                      <FormControl>
                        <Input placeholder="Open source contributor" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="bio"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bio</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Tell us about yourself..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="visibility"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Visibility</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select visibility" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="public">Public</SelectItem>
                          <SelectItem value="link_only">Link Only</SelectItem>
                          <SelectItem value="private">Private</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Saving..." : "Save Profile"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/lib/api";
import { Shield } from "lucide-react";

interface Profile {
  headline: string | null;
  shareableSlug: string | null;
  trustBadgeLevel: number;
  ecosystems: string[];
}

export function PublicProfile() {
  const { slug } = useParams<{ slug: string }>();

  const { data: profile, isLoading, isError, error } = useQuery({
    queryKey: ["profile", slug],
    queryFn: () => apiClient.get<Profile>(`/profile/${slug}`),
    enabled: !!slug,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-64 w-64 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (isError || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <h2 className="text-xl font-semibold">Profile not found</h2>
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "This profile doesn't exist or couldn't be loaded."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-12">
      <div className="flex flex-col items-center gap-6">
        <Avatar className="h-24 w-24">
          <AvatarFallback className="text-2xl">
            {profile.shareableSlug?.slice(0, 2).toUpperCase() ?? "?"}
          </AvatarFallback>
        </Avatar>
        <div className="text-center">
          <h1 className="font-mono text-2xl font-bold">{profile.shareableSlug}</h1>
          {profile.headline && (
            <p className="mt-2 text-muted-foreground">{profile.headline}</p>
          )}
          <div className="mt-2 flex justify-center gap-2">
            {profile.trustBadgeLevel > 0 && (
              <Badge variant="outline" className="gap-1">
                <Shield className="h-3 w-3" />
                Trust Level {profile.trustBadgeLevel}
              </Badge>
            )}
          </div>
        </div>

        {profile.ecosystems.length > 0 && (
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Ecosystems</CardTitle>
              <CardDescription>Active contribution areas</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {profile.ecosystems.map((eco) => (
                  <Badge key={eco} variant="secondary">{eco}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

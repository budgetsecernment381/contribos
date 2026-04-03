import { prisma } from "../../lib/prisma.js";
import type { Result } from "../../common/types/result.js";
import { ok, err } from "../../common/types/result.js";
import { notFound, forbidden } from "../../common/errors/app-error.js";
import type { ProfileVisibility, LlmProvider } from "@prisma/client";

export interface ProfileSettings {
  visibility: ProfileVisibility;
  shareableSlug: string | null;
  headline: string | null;
  bio: string | null;
  preferredLlmProvider: LlmProvider | null;
  preferredLlmModel: string | null;
}

export interface PublicProfile {
  headline: string | null;
  shareableSlug: string | null;
  trustBadgeLevel: number;
  ecosystems: string[];
}

/**
 * Get profile settings for authenticated user.
 */
export async function getProfileSettings(
  userId: string
): Promise<Result<ProfileSettings>> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
  });
  if (!profile) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) return err(notFound("User not found"));
    return ok({
      visibility: "link_only",
      shareableSlug: null,
      headline: null,
      bio: null,
      preferredLlmProvider: null,
      preferredLlmModel: null,
    });
  }

  return ok({
    visibility: profile.visibility,
    shareableSlug: profile.shareableSlug,
    headline: profile.headline,
    bio: profile.bio,
    preferredLlmProvider: profile.preferredLlmProvider,
    preferredLlmModel: profile.preferredLlmModel,
  });
}

/**
 * Update profile settings.
 */
export async function updateProfileSettings(
  userId: string,
  input: Partial<ProfileSettings>
): Promise<Result<ProfileSettings>> {
  const profile = await prisma.userProfile.upsert({
    where: { userId },
    create: {
      userId,
      visibility: (input.visibility as ProfileVisibility) ?? "link_only",
      shareableSlug: input.shareableSlug ?? null,
      headline: input.headline ?? null,
      bio: input.bio ?? null,
      ...(input.preferredLlmProvider !== undefined && {
        preferredLlmProvider: input.preferredLlmProvider,
      }),
      ...(input.preferredLlmModel !== undefined && {
        preferredLlmModel: input.preferredLlmModel,
      }),
    },
    update: {
      ...(input.visibility && { visibility: input.visibility }),
      ...(input.shareableSlug !== undefined && {
        shareableSlug: input.shareableSlug,
      }),
      ...(input.headline !== undefined && { headline: input.headline }),
      ...(input.bio !== undefined && { bio: input.bio }),
      ...(input.preferredLlmProvider !== undefined && {
        preferredLlmProvider: input.preferredLlmProvider,
      }),
      ...(input.preferredLlmModel !== undefined && {
        preferredLlmModel: input.preferredLlmModel,
      }),
    },
  });

  return ok({
    visibility: profile.visibility,
    shareableSlug: profile.shareableSlug,
    headline: profile.headline,
    bio: profile.bio,
    preferredLlmProvider: profile.preferredLlmProvider,
    preferredLlmModel: profile.preferredLlmModel,
  });
}

/**
 * Get public profile by slug. Visibility enforced.
 */
export async function getPublicProfile(
  slug: string,
  requestUserId?: string
): Promise<Result<PublicProfile>> {
  const profile = await prisma.userProfile.findUnique({
    where: { shareableSlug: slug },
    include: {
      user: { include: { ecosystems: true } },
    },
  });
  if (!profile) return err(notFound("Profile not found"));

  if (profile.visibility === "private" && profile.userId !== requestUserId) {
    return err(forbidden("Profile is private"));
  }

  return ok({
    headline: profile.headline,
    shareableSlug: profile.shareableSlug,
    trustBadgeLevel: profile.trustBadgeLevel,
    ecosystems: profile.user.ecosystems.map((e) => e.ecosystemName),
  });
}

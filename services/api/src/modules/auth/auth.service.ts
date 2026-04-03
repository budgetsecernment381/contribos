import { prisma } from "../../lib/prisma.js";
import type { Result } from "../../common/types/result.js";
import { ok, err } from "../../common/types/result.js";
import {
  unauthorized,
  internalError,
} from "../../common/errors/app-error.js";
import type { UserRole } from "@prisma/client";
import { randomBytes } from "crypto";

export interface GitHubUser {
  id: number;
  login: string;
  email: string | null;
  avatar_url: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: { id: string; role: UserRole; tier: number };
}

/**
 * Find or create user from GitHub OAuth profile.
 */
export interface AuthUser {
  id: string;
  role: UserRole;
  tier: number;
  githubUsername: string;
  email: string | null;
  avatarUrl: string | null;
  onboardingComplete: boolean;
}

export async function findOrCreateUser(
  githubUser: GitHubUser,
  githubAccessToken?: string
): Promise<Result<AuthUser>> {
  try {
    const user = await prisma.user.upsert({
      where: { githubId: githubUser.id },
      create: {
        githubId: githubUser.id,
        githubUsername: githubUser.login,
        email: githubUser.email,
        avatarUrl: githubUser.avatar_url,
        ...(githubAccessToken && { githubAccessToken }),
      },
      update: {
        githubUsername: githubUser.login,
        email: githubUser.email ?? undefined,
        avatarUrl: githubUser.avatar_url ?? undefined,
        ...(githubAccessToken && { githubAccessToken }),
      },
    });
    return ok({
      id: user.id,
      role: user.role,
      tier: user.tier,
      githubUsername: user.githubUsername,
      email: user.email,
      avatarUrl: user.avatarUrl,
      onboardingComplete: user.onboardingComplete,
    });
  } catch (e) {
    return err(internalError("Failed to create or update user"));
  }
}

/**
 * Issue access and refresh tokens for a user.
 * Refresh token is hashed before storage.
 */
export async function issueTokens(
  userId: string,
  role: UserRole,
  tier: number,
  signAccess: (payload: object) => string,
  signRefresh: (payload: object) => string
): Promise<{ accessToken: string; refreshToken: string }> {
  const plainRefreshToken = randomBytes(32).toString("hex");
  const hashedRefresh = await hashRefreshToken(plainRefreshToken);

  await prisma.user.update({
    where: { id: userId },
    data: { refreshToken: hashedRefresh },
  });

  const accessToken = signAccess({
    id: userId,
    role,
    tier,
  });

  const signedRefresh = signRefresh({
    id: userId,
    token: plainRefreshToken,
  });

  return { accessToken, refreshToken: signedRefresh };
}

async function hashRefreshToken(token: string): Promise<string> {
  const { default: bcrypt } = await import("bcryptjs");
  return bcrypt.hash(token, 10);
}

/**
 * Verify refresh token and rotate to new tokens.
 */
export async function refreshTokens(
  userId: string,
  tokenFromCookie: string,
  signAccess: (payload: object) => string,
  signRefresh: (payload: object) => string
): Promise<Result<AuthTokens>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });
  if (!user?.refreshToken) {
    return err(unauthorized("Invalid refresh token"));
  }

  const valid = await verifyRefreshToken(tokenFromCookie, user.refreshToken);
  if (!valid) {
    return err(unauthorized("Invalid refresh token"));
  }

  const tokens = await issueTokens(
    user.id,
    user.role,
    user.tier,
    signAccess,
    signRefresh
  );

  return ok({
    ...tokens,
    user: { id: user.id, role: user.role, tier: user.tier },
  });
}

async function verifyRefreshToken(
  plain: string,
  hashed: string
): Promise<boolean> {
  const { default: bcrypt } = await import("bcryptjs");
  return bcrypt.compare(plain, hashed);
}

/**
 * Revoke session by clearing refresh token.
 */
export async function revokeSession(userId: string): Promise<Result<void>> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
    return ok(undefined);
  } catch {
    return err(internalError("Failed to revoke session"));
  }
}

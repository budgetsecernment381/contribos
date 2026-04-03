import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { getEnv } from "../../common/config/env.js";
import {
  findOrCreateUser,
  issueTokens,
  refreshTokens,
  revokeSession,
} from "./auth.service.js";

/**
 * Initiate GitHub OAuth flow - redirect to GitHub.
 */
async function githubCallback(
  req: FastifyRequest<{
    Querystring: { code?: string; state?: string };
  }>,
  reply: FastifyReply
) {
  const code = req.query.code;
  if (!code) {
    return reply.status(400).send({
      code: "VALIDATION_ERROR",
      message: "Missing code parameter",
    });
  }

  const expectedState = req.cookies.oauth_state;
  if (!expectedState || req.query.state !== expectedState) {
    return reply.status(400).send({
      code: "VALIDATION_ERROR",
      message: "Invalid OAuth state parameter",
    });
  }
  reply.clearCookie("oauth_state", { path: "/" });

  const env = getEnv();
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: env.GITHUB_CALLBACK_URL,
    }),
  });

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
  };

  if (!tokenData.access_token) {
    return reply.status(400).send({
      code: "UNAUTHORIZED",
      message: tokenData.error ?? "Failed to exchange code",
    });
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  });

  if (!userRes.ok) {
    return reply.status(502).send({
      code: "INTERNAL_ERROR",
      message: "Failed to fetch GitHub user profile",
    });
  }

  const githubUser = (await userRes.json()) as {
    id: number;
    login: string;
    email: string | null;
    avatar_url: string | null;
  };

  const result = await findOrCreateUser(githubUser, tokenData.access_token);
  if (!result.ok) {
    return reply.status(500).send(result.error.toJSON());
  }

  const { signAccess, signRefresh } = req.server as FastifyInstance & {
    signAccess: (p: object) => string;
    signRefresh: (p: object) => string;
  };

  const tokens = await issueTokens(
    result.data.id,
    result.data.role,
    result.data.tier,
    signAccess,
    signRefresh
  );

  const frontendOrigin = env.CORS_ORIGIN || "http://localhost:3000";
  const callbackUrl = new URL("/auth/callback", frontendOrigin);

  reply
    .setCookie("refreshToken", tokens.refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    })
    .setCookie("accessToken", tokens.accessToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 15 * 60,
      path: "/",
    })
    .redirect(callbackUrl.toString());
}

/**
 * Refresh access token using refresh token from cookie.
 */
async function refresh(req: FastifyRequest, reply: FastifyReply) {
  const refreshTokenCookie = req.cookies.refreshToken;
  if (!refreshTokenCookie) {
    return reply.status(401).send({
      code: "UNAUTHORIZED",
      message: "Missing refresh token",
    });
  }

  let payload: { id: string; token: string };
  try {
    payload = req.server.jwtRefresh.verify(refreshTokenCookie) as {
      id: string;
      token: string;
    };
  } catch {
    return reply.status(401).send({
      code: "UNAUTHORIZED",
      message: "Invalid refresh token",
    });
  }

  const { signAccess, signRefresh } = req.server as FastifyInstance & {
    signAccess: (p: object) => string;
    signRefresh: (p: object) => string;
  };

  const result = await refreshTokens(
    payload.id,
    payload.token,
    signAccess,
    signRefresh
  );

  if (!result.ok) {
    return reply.status(401).send(result.error.toJSON());
  }

  reply
    .setCookie("refreshToken", result.data.refreshToken, {
      httpOnly: true,
      secure: getEnv().NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    })
    .send({
      accessToken: result.data.accessToken,
      user: result.data.user,
    });
}

/**
 * Logout - revoke session and clear cookie.
 * Attempts JWT-based user identification first, then falls back to refresh token cookie.
 */
async function logout(req: FastifyRequest, reply: FastifyReply) {
  let userId: string | undefined;

  try {
    await req.jwtVerify();
    userId = (req.user as { id?: string } | undefined)?.id;
  } catch {
    const refreshCookie = req.cookies.refreshToken;
    if (refreshCookie) {
      try {
        const payload = req.server.jwtRefresh.verify(refreshCookie) as { id?: string };
        userId = payload.id;
      } catch {
        // Cookie invalid or expired — proceed to clear it anyway
      }
    }
  }

  if (userId) {
    await revokeSession(userId);
  }

  reply
    .clearCookie("refreshToken", { path: "/" })
    .clearCookie("accessToken", { path: "/" })
    .send({ ok: true });
}

/**
 * Get current authenticated user.
 */
async function getMe(req: FastifyRequest, reply: FastifyReply) {
  const userId = (req.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return reply
      .status(401)
      .send({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return reply
      .status(404)
      .send({ code: "NOT_FOUND", message: "User not found" });
  }
  return {
    user: {
      id: user.id,
      githubUsername: user.githubUsername,
      email: user.email,
      avatarUrl: user.avatarUrl,
      role: user.role,
      tier: user.tier,
      onboardingComplete: user.onboardingComplete,
      creditBalance: user.creditBalance,
      planTier: user.planTier,
    },
  };
}

/**
 * Register auth routes.
 */
export async function registerAuthRoutes(
  fastify: FastifyInstance
): Promise<void> {
  fastify.get("/github", async (_req, reply) => {
    const env = getEnv();
    const state = crypto.randomUUID();
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
    url.searchParams.set("redirect_uri", env.GITHUB_CALLBACK_URL);
    url.searchParams.set("scope", "read:user user:email public_repo");
    url.searchParams.set("state", state);
    reply.setCookie("oauth_state", state, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 300,
      path: "/",
    });
    return reply.redirect(url.toString());
  });

  fastify.get("/github/callback", githubCallback);

  fastify.post("/refresh", refresh);

  fastify.get("/me", { preHandler: [fastify.authenticate] }, getMe);

  fastify.post("/logout", logout);
}

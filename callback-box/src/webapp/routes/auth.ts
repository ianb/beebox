/**
 * Google OAuth authentication routes.
 *
 * GET /auth/login    — redirect to Google OAuth consent
 * GET /auth/callback — exchange code for token, set session cookie
 * GET /auth/logout   — clear session cookie
 * GET /auth/me       — return current user info
 */

import type { FastifyInstance } from "fastify";
import { OAuth2Client } from "google-auth-library";
import {
  signSession,
  getSessionUser,
  getOwnerEmail,
  isAuthEnabled,
  COOKIE_NAME,
  SESSION_MAX_AGE_MS,
} from "../auth.js";
import { getPublicUrl } from "../../lib/public-url.js";
import { canAccessBox } from "../box-access.js";
import type { BoxSpec } from "../server.js";

interface AuthRoutesOptions {
  boxes: BoxSpec[];
  /**
   * Fallback base URL for `getPublicUrl()` when neither `CB_PUBLIC_URL` nor
   * `PUBLIC_URL` is set — defaults to the standalone box server's own
   * default port (3210). The hub (`src/hub/hub-server.ts`, Track D chunk D2)
   * passes ITS OWN `host:port` here instead: without this, an unconfigured
   * hub's OAuth redirect URI would name port 3210 (the dev-router default,
   * not the hub's own default of 4310 or whatever `hub.json` configures),
   * so Google would round-trip the login back to a server that was never
   * listening there.
   */
  publicUrlFallback?: string;
}

/**
 * Register the login surface: the full OAuth routes when auth is enabled,
 * or a stub `/auth/me` (always `null`) otherwise. Factored out so both the
 * standalone box server (`server.ts`) and the hub (`src/hub/hub-server.ts`,
 * Track D chunk D2) get identical behavior from one place — the hub hosts
 * login for the whole fleet, and reusing this exact function is what keeps
 * that from becoming a second, drifting copy of the OAuth flow.
 */
export async function registerAuthSurface(server: FastifyInstance, options: AuthRoutesOptions): Promise<void> {
  if (isAuthEnabled()) {
    await server.register(registerAuthRoutes, options);
  } else {
    // Auth disabled (no GOOGLE_OAUTH_CLIENT_ID — e.g. local dev): answer the
    // client's /auth/me probe with `200 null` instead of letting it 404 and
    // spam the browser console. There's no session, so there's no user.
    server.get("/auth/me", async (_request, reply) => {
      return reply.type("application/json").send("null");
    });
  }
}

export async function registerAuthRoutes(
  server: FastifyInstance,
  options: AuthRoutesOptions,
) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET!;
  const publicUrl = getPublicUrl(options.publicUrlFallback ?? "http://localhost:3210");
  const redirectUri = `${publicUrl}/auth/callback`;

  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

  server.get<{ Querystring: { returnTo?: string } }>(
    "/auth/login",
    async (request, reply) => {
      const returnTo = request.query.returnTo || "/";
      const authorizeUrl = oauth2Client.generateAuthUrl({
        scope: ["openid", "email", "profile"],
        state: returnTo,
        prompt: "select_account",
      });
      return reply.redirect(authorizeUrl);
    },
  );

  server.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/callback",
    async (request, reply) => {
      if (request.query.error) {
        return reply.status(400).send({ error: `OAuth error: ${request.query.error}` });
      }

      const code = request.query.code;
      if (!code) {
        return reply.status(400).send({ error: "Missing authorization code" });
      }

      let tokens;
      try {
        const result = await oauth2Client.getToken(code);
        tokens = result.tokens;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const response = (err as { response?: { data?: unknown } })?.response?.data;
        console.error("[auth] Token exchange failed:", message);
        if (response) console.error("[auth] Google response:", JSON.stringify(response));
        console.error("[auth] Redirect URI used:", redirectUri);
        console.error("[auth] Client ID:", clientId.slice(0, 20) + "...");
        return reply.status(500).send({ error: `Token exchange failed: ${message}` });
      }

      const idToken = tokens.id_token;
      if (!idToken) {
        return reply.status(400).send({ error: "No ID token received" });
      }

      let email: string;
      let displayName: string;
      let picture: string | undefined;
      try {
        const ticket = await oauth2Client.verifyIdToken({
          idToken,
          audience: clientId,
        });
        const payload = ticket.getPayload();
        if (!payload?.email) {
          return reply.status(400).send({ error: "No email in token" });
        }
        email = payload.email;
        displayName = payload.name || email;
        picture = payload.picture;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[auth] ID token verification failed:", message);
        return reply.status(500).send({ error: `Token verification failed: ${message}` });
      }

      const sessionValue = signSession({ email, name: displayName, ...(picture ? { picture } : {}) });
      const returnTo = request.query.state || "/";

      return reply
        .setCookie(COOKIE_NAME, sessionValue, {
          path: "/",
          httpOnly: true,
          secure: publicUrl.startsWith("https"),
          sameSite: "lax",
          maxAge: SESSION_MAX_AGE_MS / 1000,
        })
        .redirect(returnTo);
    },
  );

  server.get("/auth/logout", async (_request, reply) => {
    return reply
      .clearCookie(COOKIE_NAME, { path: "/" })
      .redirect("/");
  });

  server.get("/auth/me", async (request, reply) => {
    const user = getSessionUser(request);
    if (!user) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    // Determine which boxes this user can access
    const ownerEmail = getOwnerEmail();
    const accessibleBoxes: string[] = [];
    for (const box of options.boxes) {
      if (await canAccessBox({ boxRoot: box.boxRoot, email: user.email, ownerEmail })) {
        accessibleBoxes.push(box.slug);
      }
    }

    return {
      email: user.email,
      name: user.name,
      picture: user.picture,
      isOwner: user.email === ownerEmail,
      boxes: accessibleBoxes,
    };
  });
}

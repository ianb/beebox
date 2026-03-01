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
  getSessionEmail,
  getPublicUrl,
  COOKIE_NAME,
  SESSION_MAX_AGE_MS,
} from "../auth.js";
import { loadBoxConfig } from "../box-config.js";
import type { BoxSpec } from "../server.js";

interface AuthRoutesOptions {
  boxes: BoxSpec[];
}

export async function registerAuthRoutes(
  server: FastifyInstance,
  options: AuthRoutesOptions,
) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET!;
  const publicUrl = getPublicUrl();
  const redirectUri = `${publicUrl}/auth/callback`;

  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

  server.get<{ Querystring: { returnTo?: string } }>(
    "/auth/login",
    async (request, reply) => {
      const returnTo = request.query.returnTo || "/";
      const authorizeUrl = oauth2Client.generateAuthUrl({
        scope: ["openid", "email"],
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
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[auth] ID token verification failed:", message);
        return reply.status(500).send({ error: `Token verification failed: ${message}` });
      }

      const sessionValue = signSession(email);
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
    const email = getSessionEmail(request);
    if (!email) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    // Determine which boxes this user can access
    const accessibleBoxes: string[] = [];
    for (const box of options.boxes) {
      const config = await loadBoxConfig(box.boxRoot);
      if (!config.allowedEmails?.length || config.allowedEmails.includes(email)) {
        accessibleBoxes.push(box.slug);
      }
    }

    return { email, boxes: accessibleBoxes };
  });
}

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
import { isRecord } from "../../lib/is-record.js";
import {
  signSession,
  getSessionUser,
  getOwnerEmail,
  authRequired,
  COOKIE_NAME,
  SESSION_MAX_AGE_MS,
} from "../auth.js";
import { getPublicUrl } from "../../lib/public-url.js";
import { canAccessBox } from "../box-access.js";
import type { BoxSpec } from "../server.js";
import { getGoogleClientCreds } from "../../connectors/google-auth.js";

/** Thrown when auth is enabled (GOOGLE_OAUTH_CLIENT_ID set) but the paired
 * GOOGLE_OAUTH_CLIENT_SECRET is missing — a misconfiguration, not a request
 * failure, so it fails the server at route-registration time. */
export class MissingOAuthClientSecretError extends Error {
  constructor() {
    super(
      "GOOGLE_OAUTH_CLIENT_ID is set but GOOGLE_OAUTH_CLIENT_SECRET is missing — " +
        "both must be configured together to enable Google OAuth.",
    );
    this.name = "MissingOAuthClientSecretError";
  }
}

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
 * Register the login surface. Two independent halves:
 *
 * - **Google OAuth routes** (`/auth/login`, `/auth/callback`, `/auth/logout`)
 *   register ONLY when Google is configured (`getGoogleClientCreds()` returns a
 *   pair). Google availability is now a private concern of this module — the
 *   always-on-auth plan severed it from "is this box protected." An
 *   ID-without-secret half-config is a misconfiguration, not "Google absent",
 *   so it still fails loudly (`MissingOAuthClientSecretError`).
 * - **`/auth/me`** registers ALWAYS (see `registerAuthMe`): a session answers as
 *   before, open mode answers `{ "open": true }`, and an unauthenticated request
 *   with auth required answers `401`.
 *
 * Factored out so both the standalone box server (`server.ts`) and the hub
 * (`src/hub/hub-server.ts`) get identical behavior from one place — the hub
 * hosts login for the whole fleet, and reusing this exact function is what keeps
 * that from becoming a second, drifting copy of the OAuth flow.
 */
export async function registerAuthSurface(server: FastifyInstance, options: AuthRoutesOptions): Promise<void> {
  if (process.env.GOOGLE_OAUTH_CLIENT_ID) {
    await server.register(registerAuthRoutes, options);
  }
  registerAuthMe(server, options);
}

/**
 * `GET /auth/me` — always registered. With a session, returns the user and the
 * boxes they can access (unchanged). In open mode (the
 * `CB_ALLOW_UNAUTHENTICATED` opt-out), returns `{ "open": true }` so the SPA can
 * surface the persistent open-mode banner instead of a bogus signed-out state.
 * Otherwise (auth required, no session) returns `401`.
 */
function registerAuthMe(server: FastifyInstance, options: AuthRoutesOptions): void {
  server.get("/auth/me", async (request, reply) => {
    const user = getSessionUser(request);
    if (user) {
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
    }
    if (!authRequired()) {
      return reply.type("application/json").send(JSON.stringify({ open: true }));
    }
    return reply.status(401).send({ error: "Not authenticated" });
  });
}

export async function registerAuthRoutes(
  server: FastifyInstance,
  options: AuthRoutesOptions,
) {
  const creds = getGoogleClientCreds();
  if (!creds) throw new MissingOAuthClientSecretError();
  const { clientId, clientSecret } = creds;
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
        const errResponse = isRecord(err) ? err["response"] : undefined;
        const response = isRecord(errResponse) ? errResponse["data"] : undefined;
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
}

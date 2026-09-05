/**
 * Google OAuth routes for the login surface (`GET /auth/google`,
 * `GET /auth/callback`). Split out of `routes/auth.ts` to keep that module under
 * the line cap; registered by `registerAuthSurface` there ONLY when Google is
 * configured (`getGoogleClientCreds()` returns an id+secret pair). Google
 * availability is a private concern of the login surface — the always-on-auth
 * plan severed it from "is this box protected."
 */

import type { FastifyInstance } from "fastify";
import { OAuth2Client } from "google-auth-library";
import { isRecord } from "../../lib/is-record.js";
import { signSession, COOKIE_NAME, SESSION_MAX_AGE_MS } from "../auth.js";
import { readBasePrefix } from "../base-prefix.js";
import { sanitizeReturnTo } from "../login-page.js";
import { getPublicUrl } from "../../lib/public-url.js";
import { getGoogleClientCreds } from "../../connectors/google-auth.js";
import type { AuthRoutesOptions } from "./auth.js";
import { canonicalizeEmail } from "../local-users.js";

/** Thrown when auth is enabled (GOOGLE_OAUTH_CLIENT_ID set) but the paired
 * GOOGLE_OAUTH_CLIENT_SECRET is missing — a misconfiguration, not a request
 * failure, so it fails the server at route-registration time. */
class MissingOAuthClientSecretError extends Error {
  constructor() {
    super(
      "GOOGLE_OAUTH_CLIENT_ID is set but GOOGLE_OAUTH_CLIENT_SECRET is missing — " +
        "both must be configured together to enable Google OAuth.",
    );
    this.name = "MissingOAuthClientSecretError";
  }
}

export async function registerAuthRoutes(
  server: FastifyInstance,
  options: AuthRoutesOptions,
) {
  const creds = await getGoogleClientCreds();
  if (!creds) throw new MissingOAuthClientSecretError();
  const { clientId, clientSecret } = creds;
  const publicUrl = getPublicUrl(options.publicUrlFallback ?? "http://localhost:3210");
  const redirectUri = `${publicUrl}/auth/callback`;

  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

  server.get<{ Querystring: { returnTo?: string } }>(
    "/auth/google",
    async (request, reply) => {
      // Sanitize BEFORE it becomes OAuth `state` — only a same-origin path is
      // honored, closing an open redirect (`?returnTo=https://evil` → `state` →
      // raw redirect in the callback). Fails safe to `<prefix>/`.
      const returnTo = sanitizeReturnTo({ raw: request.query.returnTo, prefix: readBasePrefix(request.headers) });
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
        if (!payload?.email || payload.email_verified !== true) {
          return reply.status(400).send({ error: "No verified email in token" });
        }
        email = canonicalizeEmail(payload.email);
        displayName = payload.name || email;
        picture = payload.picture;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[auth] ID token verification failed:", message);
        return reply.status(500).send({ error: `Token verification failed: ${message}` });
      }

      const sessionValue = signSession({ email, name: displayName, ...(picture ? { picture } : {}) });
      // Re-sanitize the state on the way out: even a hand-crafted `state` (the
      // value round-trips through Google and is attacker-controllable) can only
      // ever redirect to a same-origin path, never off-origin.
      const returnTo = sanitizeReturnTo({ raw: request.query.state, prefix: readBasePrefix(request.headers) });

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
}

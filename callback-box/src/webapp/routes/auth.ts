/**
 * The login surface: local password login, first-run setup, logout, `/auth/me`,
 * the method-advertisement endpoint, and (when configured) Google OAuth.
 *
 * Always-registered (the local half, `registerPasswordRoutes`):
 *   GET  /auth/login   — serve the SPA login page
 *   POST /auth/login   — verify {email,password}, mint session cookie (204)
 *   GET  /auth/setup   — serve the SPA setup page
 *   POST /auth/setup   — create the owner account from a live setup token
 *   GET  /auth/methods — advertise available login methods to the SPA
 *   GET  /auth/logout  — clear session cookie
 *   GET  /auth/me      — current user, or {open:true} in open mode, or 401
 *
 * Registered only when Google is configured (`registerAuthRoutes`):
 *   GET  /auth/google   — redirect to Google OAuth consent
 *   GET  /auth/callback — exchange code for token, set session cookie
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { OAuth2Client } from "google-auth-library";
import { isRecord } from "../../lib/is-record.js";
import { invariant } from "../../lib/invariant.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import {
  signSession,
  getSessionUser,
  getOwnerEmail,
  authRequired,
  isHubMode,
  COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  type SessionUser,
} from "../auth.js";
import { getPublicUrl } from "../../lib/public-url.js";
import { canAccessBox } from "../box-access.js";
import type { BoxSpec } from "../server.js";
import { getGoogleClientCreds } from "../../connectors/google-auth.js";
import { canonicalizeEmail, createFirstUser, listUsers, verifyPassword } from "../local-users.js";
import { AuthStoreUnavailableError, OwnerEmailMismatchError, UserExistsError } from "../local-users-errors.js";
import { CONCURRENCY_RETRY_MS, loginThrottle } from "../login-throttle.js";
import { checkSetupToken, clearSetupToken } from "../setup-token.js";

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
 * Register the login surface. Three parts:
 *
 * - **Local password surface** (`registerPasswordRoutes`: `/auth/login` page +
 *   POST, `/auth/setup` page + POST, `/auth/methods`, `/auth/logout`) — the
 *   always-present half of local-first. It reads the credential store and signs
 *   sessions, so it must exist at standalone boxes and at the hub, but NEVER at
 *   a hub-mode child (which is header-gated and never holds the session secret).
 *   That split is guaranteed structurally: `registerAuthSurface` is only ever
 *   called when `!isHubMode()` — the standalone server takes its hub-mode branch
 *   to a `404 /auth/*` instead of calling this (`server.ts`), and the hub
 *   PROCESS itself is not in hub mode (it mints the secret, it doesn't receive
 *   one). `registerPasswordRoutes` asserts that invariant.
 * - **Google OAuth routes** (`/auth/google`, `/auth/callback`) register ONLY
 *   when Google is configured (`getGoogleClientCreds()` returns a pair). Google
 *   availability is now a private concern of this module — the always-on-auth
 *   plan severed it from "is this box protected." An ID-without-secret
 *   half-config is a misconfiguration, not "Google absent", so it still fails
 *   loudly (`MissingOAuthClientSecretError`).
 * - **`/auth/me`** registers ALWAYS (see `registerAuthMe`): a session answers as
 *   before, open mode answers `{ "open": true }`, and an unauthenticated request
 *   with auth required answers `401`.
 *
 * Factored out so both the standalone box server (`server.ts`) and the hub
 * (`src/hub/hub-server.ts`) get identical behavior from one place — the hub
 * hosts login for the whole fleet, and reusing this exact function is what keeps
 * that from becoming a second, drifting copy of the login flow.
 */
export async function registerAuthSurface(server: FastifyInstance, options: AuthRoutesOptions): Promise<void> {
  registerPasswordRoutes(server);
  if (process.env.GOOGLE_OAUTH_CLIENT_ID) {
    await server.register(registerAuthRoutes, options);
  }
  registerAuthMe(server, options);
}

const loginBodySchema = z.object({ email: z.string(), password: z.string() });
const setupBodySchema = z.object({
  email: z.string(),
  name: z.string(),
  password: z.string(),
  token: z.string(),
});

/** Serve the SPA (its frontend router owns the login/setup screens). Bundles are
 *  public pre-auth by design — the client must load before a user can
 *  auth-navigate. Degrades to a minimal built-in page when the bundle isn't
 *  built, the same shape the box picker / SPA fallback use elsewhere. */
function serveLoginSpa(reply: FastifyReply, frontendDist: string): FastifyReply {
  const indexHtml = path.join(frontendDist, "index.html");
  if (fs.existsSync(indexHtml)) {
    return reply.type("text/html").send(fs.readFileSync(indexHtml, "utf-8"));
  }
  return reply.type("text/html").send(
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Callback Box — Sign in</title></head>" +
      "<body style=\"font-family:system-ui,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem\">" +
      "<h1>Sign in</h1><p>The frontend bundle is not built. Build it with " +
      "<code>pnpm build:frontend</code>, or create the first account on the host with " +
      "<code>cb auth create-user</code>.</p></body></html>",
  );
}

/** Sign a session for `user` and set the `cb_session` cookie — the SAME options
 *  the Google callback uses (`path:/`, httpOnly, `secure` iff https, sameSite
 *  lax, the 30-day max-age). Signs via `signSession` only, so the cookie shape
 *  stays the single one Track D extends with `gen`. */
function setSessionCookie(reply: FastifyReply, { request, user }: { request: FastifyRequest; user: SessionUser }): void {
  reply.setCookie(COOKIE_NAME, signSession(user), {
    path: "/",
    httpOnly: true,
    secure: request.protocol === "https",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });
}

/**
 * The local password surface. Registered only in a non-hub-mode process (see
 * `registerAuthSurface`); the invariant makes a mistaken hub-mode registration
 * a loud failure rather than a silent security hole (a hub-mode child hosting
 * credential verification would be exactly the drift the header-gating exists to
 * prevent).
 */
function registerPasswordRoutes(server: FastifyInstance): void {
  invariant(!isHubMode(), "registerPasswordRoutes must never run in hub mode — the hub owns fleet login");
  const frontendDist = path.join(PACKAGE_ROOT, "src/frontend/dist");

  server.get("/auth/login", async (_request, reply) => serveLoginSpa(reply, frontendDist));
  server.get("/auth/setup", async (_request, reply) => serveLoginSpa(reply, frontendDist));

  server.get("/auth/logout", async (_request, reply) => {
    return reply.clearCookie(COOKIE_NAME, { path: "/" }).redirect("/");
  });

  // Advertise available methods so the SPA renders the right form without probing.
  server.get("/auth/methods", async () => {
    return {
      password: true,
      google: getGoogleClientCreds() !== null,
      setupRequired: authRequired() && listUsers().length === 0,
    };
  });

  server.post("/auth/login", async (request, reply) => {
    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid request" });
    const email = canonicalizeEmail(parsed.data.email);
    const ip = request.ip;

    const decision = loginThrottle.check({ ip, email, now: Date.now() });
    if (!decision.allowed) {
      console.warn(`[auth] throttled login for ${JSON.stringify(email)} from ${ip}`);
      return reply.status(429).send({ error: "Too many attempts, please wait", retryAfterMs: decision.retryAfterMs });
    }
    if (!loginThrottle.acquireHashSlot()) {
      console.warn(`[auth] login verification capacity reached; rejecting ${JSON.stringify(email)} from ${ip}`);
      return reply.status(429).send({ error: "Server busy, please retry", retryAfterMs: CONCURRENCY_RETRY_MS });
    }

    let user;
    try {
      user = await verifyPassword({ email, password: parsed.data.password });
    } catch (e) {
      if (e instanceof AuthStoreUnavailableError) {
        console.error("[auth] login failed — credential store unavailable:", e);
        return reply.status(503).send({ error: "Login temporarily unavailable" });
      }
      throw e;
    } finally {
      loginThrottle.releaseHashSlot();
    }

    if (!user) {
      loginThrottle.recordFailure({ ip, email, now: Date.now() });
      console.warn(`[auth] failed login for ${JSON.stringify(email)} from ${ip}`);
      // Unknown user and wrong password answer identically — no user enumeration.
      return reply.status(401).send({ error: "Invalid credentials" });
    }
    loginThrottle.recordSuccess({ ip, email });
    setSessionCookie(reply, { request, user: { email: user.email, name: user.name } });
    return reply.status(204).send();
  });

  server.post("/auth/setup", async (request, reply) => {
    const parsed = setupBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid request" });

    let existingUsers: number;
    try {
      existingUsers = listUsers().length;
    } catch (e) {
      if (e instanceof AuthStoreUnavailableError) {
        console.error("[auth] setup failed — credential store unavailable:", e);
        return reply.status(503).send({ error: "Setup temporarily unavailable" });
      }
      throw e;
    }
    // Once an account exists, setup is permanently closed.
    if (existingUsers > 0) {
      return reply
        .status(410)
        .send({ error: "Setup already complete", message: "An account already exists; sign in at /auth/login." });
    }

    const email = canonicalizeEmail(parsed.data.email);
    const ip = request.ip;
    const now = Date.now();

    const decision = loginThrottle.check({ ip, email, now });
    if (!decision.allowed) {
      console.warn(`[auth] throttled setup for ${JSON.stringify(email)} from ${ip}`);
      return reply.status(429).send({ error: "Too many attempts, please wait", retryAfterMs: decision.retryAfterMs });
    }

    const tokenStatus = checkSetupToken({ token: parsed.data.token, now });
    if (tokenStatus !== "valid") {
      loginThrottle.recordFailure({ ip, email, now });
      if (tokenStatus === "mismatch") {
        console.warn(`[auth] setup rejected — invalid token from ${ip}`);
        return reply.status(403).send({ error: "Invalid setup token" });
      }
      // "expired" | "absent": the one-time capability is gone.
      return reply.status(410).send({
        error: "Setup token expired",
        message: "Restart the server to print a fresh setup link, or run `cb auth create-user` on the host.",
      });
    }

    try {
      const owner = await createFirstUser({ email, name: parsed.data.name, password: parsed.data.password });
      clearSetupToken();
      loginThrottle.recordSuccess({ ip, email });
      setSessionCookie(reply, { request, user: { email: owner.email, name: owner.name } });
      return reply.status(204).send();
    } catch (e) {
      // Lost the O_EXCL race (a second setup won): the winner already created it.
      if (e instanceof UserExistsError) return reply.status(409).send({ error: "An account already exists" });
      if (e instanceof OwnerEmailMismatchError) return reply.status(400).send({ error: e.message });
      throw e;
    }
  });
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
    "/auth/google",
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
}

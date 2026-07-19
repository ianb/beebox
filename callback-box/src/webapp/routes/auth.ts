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
import type { IncomingMessage } from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { isRecord } from "../../lib/is-record.js";
import { invariant } from "../../lib/invariant.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import {
  signSession,
  getSessionUser,
  getOwnerEmail,
  authRequired,
  isHubMode,
  resolveRequestIdentity,
  COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  type SessionUser,
} from "../auth.js";
import { canAccessBox } from "../box-access.js";
import type { BoxSpec } from "../server.js";
import { getGoogleClientCreds } from "../../connectors/google-auth.js";
import { registerAuthRoutes } from "./auth-google.js";
import { canonicalizeEmail, createFirstUser, listUsers, verifyPassword } from "../local-users.js";
import { AuthStoreUnavailableError, OwnerEmailMismatchError, UserExistsError } from "../local-users-errors.js";
import { CONCURRENCY_RETRY_MS, loginThrottle } from "../login-throttle.js";
import { checkSetupToken, clearSetupToken } from "../setup-token.js";

export interface AuthRoutesOptions {
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

// Bounded inputs (FIX 4 — DoS): email at the RFC-max 254, password 1024, name
// 200, token 256. Caps the parsed fields on top of the raw-body cap below.
const loginBodySchema = z.object({ email: z.string().max(254), password: z.string().max(1024) });
const setupBodySchema = z.object({
  email: z.string().max(254),
  name: z.string().max(200),
  password: z.string().max(1024),
  token: z.string().max(256),
});

/** Cap on the raw request body these auth routes will read — they carry tiny
 *  JSON, so anything larger is abuse. Also bounds the hub raw-body read below. */
const MAX_AUTH_BODY_BYTES = 16 * 1024;

/** Truncate a user-supplied string before logging so a failed/throttled attempt
 *  can't amplify log volume with a giant "email" (FIX 4). */
function forLog(value: string): string {
  return value.length > 128 ? `${value.slice(0, 128)}…` : value;
}

/**
 * Read the JSON body for an auth POST, working in BOTH server modes (FIX 2):
 *
 * - **Standalone**: Fastify's JSON content-type parser already populated
 *   `request.body`, so it's returned as-is (the path stays byte-identical).
 * - **Behind `cb hub`**: the hub installs a wildcard content-type parser that
 *   `done(null)`s WITHOUT reading the stream (so it can proxy raw bodies to
 *   children), leaving `request.body` undefined for the hub's OWN routes. Here
 *   the still-readable `request.raw` stream is drained (bounded by
 *   `MAX_AUTH_BODY_BYTES`) and JSON-parsed.
 *
 * Throws (oversize or invalid JSON) — the caller answers 400.
 */
async function readJsonBody(request: FastifyRequest): Promise<unknown> {
  if (isRecord(request.body)) return request.body;
  const raw = await readRawBody(request.raw);
  return JSON.parse(raw);
}

class AuthBodyTooLargeError extends Error {
  constructor() {
    super(`Auth request body exceeds ${MAX_AUTH_BODY_BYTES} bytes.`);
    this.name = "AuthBodyTooLargeError";
  }
}

function readRawBody(raw: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    raw.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_AUTH_BODY_BYTES) {
        raw.destroy();
        reject(new AuthBodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    raw.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    raw.on("error", reject);
  });
}

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
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch (_e) {
      /* ignore: oversize/unparseable auth body is untrusted input — answer 400
         without logging, so a malformed request can't amplify logs (FIX 2/4). */
      return reply.status(400).send({ error: "Invalid request" });
    }
    const parsed = loginBodySchema.safeParse(body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid request" });
    const email = canonicalizeEmail(parsed.data.email);
    const ip = request.ip;

    const decision = loginThrottle.check({ ip, email, now: Date.now() });
    if (!decision.allowed) {
      console.warn(`[auth] throttled login for ${JSON.stringify(forLog(email))} from ${ip}`);
      return reply.status(429).send({ error: "Too many attempts, please wait", retryAfterMs: decision.retryAfterMs });
    }
    if (!loginThrottle.acquireHashSlot()) {
      console.warn(`[auth] login verification capacity reached; rejecting ${JSON.stringify(forLog(email))} from ${ip}`);
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
      console.warn(`[auth] failed login for ${JSON.stringify(forLog(email))} from ${ip}`);
      // Unknown user and wrong password answer identically — no user enumeration.
      return reply.status(401).send({ error: "Invalid credentials" });
    }
    loginThrottle.recordSuccess({ ip, email });
    setSessionCookie(reply, { request, user: { email: user.email, name: user.name } });
    return reply.status(204).send();
  });

  server.post("/auth/setup", async (request, reply) => {
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch (_e) {
      /* ignore: oversize/unparseable auth body is untrusted input — answer 400
         without logging, so a malformed request can't amplify logs (FIX 2/4). */
      return reply.status(400).send({ error: "Invalid request" });
    }
    const parsed = setupBodySchema.safeParse(body);
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
      console.warn(`[auth] throttled setup for ${JSON.stringify(forLog(email))} from ${ip}`);
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

    // Setup hashes a password too (createFirstUser → scrypt), so it must take the
    // SAME global concurrency slot login does (FIX 6) — otherwise concurrent
    // setup POSTs bypass the ~128MB-per-hash cap and can OOM the process.
    if (!loginThrottle.acquireHashSlot()) {
      console.warn(`[auth] setup verification capacity reached; rejecting ${JSON.stringify(forLog(email))} from ${ip}`);
      return reply.status(429).send({ error: "Server busy, please retry", retryAfterMs: CONCURRENCY_RETRY_MS });
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
    } finally {
      loginThrottle.releaseHashSlot();
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
    // Route through the shared resolver so the `gen` revocation check and the
    // distinct auth-store-unavailable outcome apply here too (Track D): a
    // password change or user removal must stop reporting the old session as
    // signed in, and a corrupt store answers 503, not a bogus signed-out 401.
    const identity = resolveRequestIdentity(request);
    if (identity.source === "unavailable") {
      return reply.status(503).send({ error: "Authentication temporarily unavailable" });
    }
    const email = identity.email;
    if (email) {
      // The resolver already validated the identity; read the cookie only to
      // enrich the response with the display picture when one is present.
      const sessionUser = getSessionUser(request);
      const ownerEmail = getOwnerEmail();
      const accessibleBoxes: string[] = [];
      for (const box of options.boxes) {
        if (await canAccessBox({ boxRoot: box.boxRoot, email, ownerEmail })) {
          accessibleBoxes.push(box.slug);
        }
      }
      return {
        email,
        name: identity.name ?? email,
        picture: sessionUser?.email === email ? sessionUser.picture : undefined,
        isOwner: email === ownerEmail,
        boxes: accessibleBoxes,
      };
    }
    if (!authRequired()) {
      return reply.type("application/json").send(JSON.stringify({ open: true }));
    }
    return reply.status(401).send({ error: "Not authenticated" });
  });
}

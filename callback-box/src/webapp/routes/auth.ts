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

import type { FastifyInstance, FastifyRequest } from "fastify";
import { invariant } from "../../lib/invariant.js";
import {
  getSessionUser,
  getOwnerEmail,
  isHubMode,
  resolveRequestIdentity,
  COOKIE_NAME,
} from "../auth.js";
import { canAccessBox } from "../box-access.js";
import { readBasePrefix } from "../base-prefix.js";
import type { BoxSpec } from "../server.js";
import { getGoogleClientCreds } from "../../connectors/google-auth.js";
import { registerAuthRoutes } from "./auth-google.js";
import { listUsers } from "../local-users.js";
import { AuthStoreUnavailableError } from "../local-users-errors.js";
import {
  renderLoginPage,
  renderSetupPage,
  sanitizeReturnTo,
  type LoginPageState,
  type SetupErrorKind,
} from "../login-page.js";
import { handleLoginPost, handleSetupPost } from "./auth-password-post.js";
import { registerAuthInviteRoutes } from "./auth-invite.js";
import { currentUserHasPassword, handlePasswordChange } from "./auth-password-change.js";
import { registerAuthPasswordResetRoutes } from "./auth-password-reset.js";

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
  await registerPasswordRoutes(server, options);
  if (process.env.GOOGLE_OAUTH_CLIENT_ID) {
    await server.register(registerAuthRoutes, options);
  }
  registerAuthMe(server, options);
}

/** Map the `?error=` query on the bare setup page to a known error kind. */
function parseSetupError(raw: string | undefined): SetupErrorKind | null {
  if (raw === "token" || raw === "exists" || raw === "mismatch" || raw === "generic") return raw;
  return null;
}

/** Whether the bare login page should show the first-run setup hint: auth is on
 *  and no account exists yet. A corrupt store degrades to "no hint" (login itself
 *  surfaces the store problem per-request). */
function computeSetupRequired(request: FastifyRequest): boolean {
  if (request.server.openAccess) return false;
  try {
    return listUsers().length === 0;
  } catch (e) {
    if (e instanceof AuthStoreUnavailableError) return false;
    throw e;
  }
}

/** Assemble the bare login page's server-rendered state from a GET request. */
async function loginPageState(
  request: FastifyRequest,
  query: { returnTo?: string; error?: string; passwordReset?: string },
): Promise<LoginPageState> {
  const prefix = readBasePrefix(request.headers);
  return {
    prefix,
    returnTo: sanitizeReturnTo({ raw: query.returnTo, prefix }),
    error: query.error === "1",
    // Box-less surface: this asks whether Google login is configured for the
    // process at all, before any box is in play, so it reads the env fallback.
    googleConfigured: (await getGoogleClientCreds()) !== null,
    setupRequired: computeSetupRequired(request),
    passwordReset: query.passwordReset === "1",
  };
}

/**
 * The local password surface. Registered only in a non-hub-mode process (see
 * `registerAuthSurface`); the invariant makes a mistaken hub-mode registration
 * a loud failure rather than a silent security hole (a hub-mode child hosting
 * credential verification would be exactly the drift the header-gating exists to
 * prevent).
 *
 * The login/setup GETs serve fully self-contained, server-rendered HTML (no
 * external or gated assets — see `login-page.ts`), so a logged-out user gets a
 * working login page even behind the authenticating dev router. The POSTs
 * (`auth-password-post.ts`) accept both the bare page's form submission and the
 * SPA/programmatic JSON API.
 */
async function registerPasswordRoutes(server: FastifyInstance, options: AuthRoutesOptions): Promise<void> {
  invariant(!isHubMode(), "registerPasswordRoutes must never run in hub mode — the hub owns fleet login");

  server.get<{ Querystring: { returnTo?: string; error?: string; passwordReset?: string } }>("/auth/login", async (request, reply) => {
    return reply.type("text/html").send(renderLoginPage(await loginPageState(request, request.query)));
  });
  server.get<{ Querystring: { token?: string; error?: string } }>("/auth/setup", async (request, reply) => {
    const prefix = readBasePrefix(request.headers);
    return reply
      .type("text/html")
      .send(renderSetupPage({ prefix, token: request.query.token ?? null, error: parseSetupError(request.query.error) }));
  });

  server.get("/auth/logout", async (_request, reply) => {
    return reply.clearCookie(COOKIE_NAME, { path: "/" }).redirect("/");
  });

  // Advertise available methods so any programmatic caller reads the same shape.
  server.get("/auth/methods", async (request) => {
    return {
      password: true,
      google: (await getGoogleClientCreds()) !== null,
      setupRequired: !request.server.openAccess && listUsers().length === 0,
    };
  });

  // The form-accepting POSTs live in their OWN encapsulated plugin so the
  // `application/x-www-form-urlencoded` parser is confined to this context and
  // NEVER leaks to sibling/box routes. The parser `done(null)`s WITHOUT draining
  // (the SAME shape the hub's `*` parser uses), so the handler reads the
  // still-readable raw stream itself; without it a standalone box would 415 a
  // form POST. Scoping matters: a root-level parser would make every unrelated
  // box POST (capture, chat) run with an unread body — real regressions.
  await server.register(async (formScope) => {
    // eslint-disable-next-line max-params -- Fastify's addContentTypeParser callback signature is (request, payload, done)
    formScope.addContentTypeParser("application/x-www-form-urlencoded", (_request, _payload, done) => done(null));
    formScope.post("/auth/login", async (request, reply) => handleLoginPost(request, reply));
    formScope.post("/auth/setup", async (request, reply) => handleSetupPost(request, reply));
    await registerAuthInviteRoutes(formScope, options.boxes);
    await registerAuthPasswordResetRoutes(formScope, options.boxes);
    formScope.post("/auth/password", async (request, reply) => handlePasswordChange(request, reply));
  });
}

/**
 * `GET /auth/me` — always registered. With a session, returns the user and the
 * boxes they can access (unchanged). In open access (the `openAccess`
 * construction option — a test-only server-construction seam, no CLI path sets
 * it), returns `{ "open": true }` so the SPA treats it as signed-out rather
 * than misreading it as an error. Otherwise (auth required, no session)
 * returns `401`.
 */
function registerAuthMe(server: FastifyInstance, options: AuthRoutesOptions): void {
  server.get("/auth/me", async (request, reply) => {
    // Route through the shared resolver so the `gen` revocation check and the
    // distinct auth-store-unavailable outcome apply here too (Track D): a
    // password change or user removal must stop reporting the old session as
    // signed in, and a corrupt store answers 503, not a bogus signed-out 401.
    const identity = resolveRequestIdentity(request, { openAccess: request.server.openAccess });
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
        hasPassword: currentUserHasPassword(email),
        boxes: accessibleBoxes,
      };
    }
    if (request.server.openAccess) {
      return reply.type("application/json").send(JSON.stringify({ open: true }));
    }
    return reply.status(401).send({ error: "Not authenticated" });
  });
}

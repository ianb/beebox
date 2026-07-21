// The dev router's fail-closed authorization core (Track B, chunk 1 of
// callback-box/docs/plans/expose-dev-router.md).
//
// This module is PURE: it classifies a request into a route class and decides
// allow/deny, given the request facts plus INJECTED auth-resolution functions.
// It performs no I/O of its own — no fs, no network, no process.env — so the
// full truth table is unit-testable with trivial fakes (bin/router-auth.test.ts).
// Chunk 2 wires the live listeners, the real resolvers (resolveRequestIdentity /
// getOwnerEmail / resolveMobileRequestAuth / the slug→box map), the client
// `x-cb-*` strip, and the Set-Cookie Path rewrite around this decision.
//
// The gate is the SINGLE decision point: chunk 2 must call authorizeRouterRequest
// before ALL dispatch, INCLUDING the `upgrade` (WebSocket) handler, so a browser
// WS request authenticates with the same rules as any other TCP request.
//
// The router is the OUTERMOST hop: it sees `/<worktree>/...` un-stripped, so
// classification keys off `/<worktree>/<rest>`. Router infra (`/`, `/__router/*`,
// `/favicon.*`) lives at the bare root, not under a worktree.

import { assertNever } from "../callback-box/src/lib/invariant.js";
import { isPairingRedeemUrl } from "../callback-box/src/webapp/routes/pairing.js";

/** Node's incoming header bag. Repeated headers arrive as arrays. */
export type RouterHeaders = Record<string, string | string[] | undefined>;

/** A value a resolver may return directly (fakes) or as a promise (chunk-2 real, async) impls. */
type Awaitable<T> = T | Promise<T>;

/** The worktree + optional box slug a box-class request targets. */
export interface BoxTarget {
  /** The `/<worktree>` segment the router routes by. */
  targetWorktree: string;
  /**
   * The box slug (`/<worktree>/<box>/...`), or null for root-worktree requests
   * (`/<worktree>/` and `/<worktree>/api/*`) that have no single box in the path.
   * Chunk 2's resolver maps null to the worktree's default/only box (or refuses).
   */
  targetBox: string | null;
}

/**
 * The route classes of the dev router, derived from the plan's Track B gate.
 *
 * - `unauth-allowlist`: bootstrap surface reachable with no credential — the
 *   `/auth/*` API + login/setup HTML, the login SPA static assets, public
 *   favicons, and the pre-auth iOS pairing-redeem POST.
 * - `control`: MUTATING router control (`/__router/{stop,retry}` and the
 *   dashboard cold-start) — owner session AND a CSRF-safe origin.
 * - `control-read`: read-only router infra (`/__router/status`, the `/` worktree
 *   index, the `/<w>/dev/` browser) — owner session, no CSRF requirement.
 *   `json` distinguishes the machine endpoint (`/__router/status`, always a JSON
 *   401 on deny) from the browser pages (which redirect a navigation to login).
 * - `box`: a per-box or root-worktree app request (`/<w>/<box>/...`, `/<w>/api/*`,
 *   `/<w>/`) — the box precedence ladder against the TARGET box.
 * - `unknown`: anything else — deny (fail closed).
 */
export type RouterRoute =
  | { kind: "unauth-allowlist" }
  | { kind: "control" }
  | { kind: "control-read"; json: boolean }
  | ({ kind: "box" } & BoxTarget)
  | { kind: "unknown" };

/** The identity shapes the injected resolvers return (fields the gate reads). */
export interface OwnerIdentity {
  email: string;
}
export interface BoxAccessIdentity {
  email: string;
}

/**
 * The injected auth-resolution seam. Every method is I/O-free HERE (fakes in
 * tests); chunk 2 supplies real, possibly-async implementations:
 *
 * - `resolveOwnerSession` — resolveRequestIdentity (gen-aware) ∩ getOwnerEmail:
 *   a valid, non-revoked session whose user is the box owner, else null.
 * - `resolveTargetBoxRoot` — THE single slug→box source of truth (plan 2.4). It
 *   derives the target box root from the SAME map the proxy routes by, and
 *   returns null when the slug is unknown OR ambiguous (duplicate slugs fail
 *   closed) — the gate then denies rather than auth against the wrong box.
 * - `resolveBoxAccessSession` — a session whose user `canAccessBox(targetBoxRoot)`.
 * - `resolveMobileForBox` — per-box mobile bearer/cookie for `targetBoxRoot`
 *   (chunk 2 wraps resolveMobileRequestAuth); a token for box A must be false
 *   for box B.
 * - `isAgentBearer` — the agent bearer (folded into chunk 2's real box resolver;
 *   injected here so the ladder's first rung is exercised).
 * - `isCsrfSafe` — Origin / Sec-Fetch-Site same-origin assertion for mutating
 *   control.
 */
export interface RouterAuthDeps {
  resolveOwnerSession(headers: RouterHeaders): Awaitable<OwnerIdentity | null>;
  resolveTargetBoxRoot(target: BoxTarget): Awaitable<string | null>;
  resolveBoxAccessSession(headers: RouterHeaders, targetBoxRoot: string): Awaitable<BoxAccessIdentity | null>;
  resolveMobileForBox(headers: RouterHeaders, targetBoxRoot: string): Awaitable<boolean>;
  isAgentBearer(headers: RouterHeaders): Awaitable<boolean>;
  isCsrfSafe(headers: RouterHeaders): Awaitable<boolean>;
}

/** The request facts the gate reads. `trustedLocal` = arrived on the UDS. */
export interface RouterAuthInput {
  trustedLocal: boolean;
  method: string;
  url: string;
  headers: RouterHeaders;
}

/** The gate's decision. `redirectToLogin` marks a denied browser navigation. */
export type RouterAuthDecision =
  | { allow: true; route: RouterRoute }
  | { allow: false; status: 401 | 403 | 404; reason: string; redirectToLogin: boolean; route: RouterRoute };

// --- classification ---------------------------------------------------------

function pathnameOf(url: string): string {
  const q = url.indexOf("?");
  const noQuery = q === -1 ? url : url.slice(0, q);
  const h = noQuery.indexOf("#");
  return h === -1 ? noQuery : noQuery.slice(0, h);
}

/** The `/<name>` first path segment, or null for `/`, `` and malformed paths. */
function firstSegment(pathname: string): string | null {
  const m = pathname.match(/^\/([^/]+)(?:\/|$)/);
  return m ? m[1]! : null;
}

/** Login SPA static-asset prefixes (Track A rewrites these under `<prefix>/`). */
function isLoginAssetPath(rest: string): boolean {
  return (
    rest === "/manifest.webmanifest" ||
    rest === "/assets" ||
    rest.startsWith("/assets/") ||
    rest === "/icons" ||
    rest.startsWith("/icons/")
  );
}

function classifyRouterControl(pathname: string): RouterRoute {
  if (pathname === "/__router/status" || pathname === "/__router/status/") {
    return { kind: "control-read", json: true };
  }
  if (
    pathname.startsWith("/__router/stop/") ||
    pathname.startsWith("/__router/retry/") ||
    pathname.startsWith("/__router/dashboard/")
  ) {
    return { kind: "control" };
  }
  return { kind: "unknown" };
}

/**
 * Classify a request into a route class, PURELY from its method and url. Does
 * not consult any box map or session — it only reads the URL shape (chunk 2's
 * resolvers turn the extracted slug into a box root and a decision).
 */
export function classifyRouterRoute({ method, url }: { method: string; url: string }): RouterRoute {
  const pathname = pathnameOf(url);

  // The pre-auth iOS pairing bootstrap, matched by the REUSED prefix-agnostic
  // matcher (the same one the hub and box use) — the ticket is the credential.
  if (method === "POST" && isPairingRedeemUrl(url)) return { kind: "unauth-allowlist" };

  // Router infra at the bare root (never under a worktree).
  if (pathname === "/" || pathname === "") return { kind: "control-read", json: false };
  if (pathname === "/favicon.png" || pathname === "/favicon.ico") return { kind: "unauth-allowlist" };
  if (pathname === "/__router" || pathname.startsWith("/__router/")) return classifyRouterControl(pathname);
  // Bare `/dev` / `/dev/` redirect to `/main/dev/` — the dev browser (owner).
  if (pathname === "/dev" || pathname === "/dev/") return { kind: "control-read", json: false };

  const name = firstSegment(pathname);
  if (name === null) return { kind: "unknown" };
  const rest = pathname.slice(`/${name}`.length); // "" | "/..." after the worktree segment

  // `/<w>/auth/*` — login/setup HTML + the auth API (login, logout, me, methods,
  // callback). Method-agnostic: login is a POST, `/auth/me` a GET.
  if (rest === "/auth" || rest.startsWith("/auth/")) return { kind: "unauth-allowlist" };

  // `/<w>/{assets,icons,manifest.webmanifest}` — login SPA static assets (GET).
  if (method === "GET" && isLoginAssetPath(rest)) return { kind: "unauth-allowlist" };

  // `/<w>/dev` / `/<w>/dev/...` — the worktree's dev browser (owner, read-only).
  if (rest === "/dev" || rest.startsWith("/dev/")) return { kind: "control-read", json: false };

  const seg2Match = rest.match(/^\/([^/]+)(?:\/|$)/);
  const seg2 = seg2Match ? seg2Match[1]! : null;

  // Root-worktree API (`/<w>/api/*`) — box class, no single box slug in the path.
  if (seg2 === "api") return { kind: "box", targetWorktree: name, targetBox: null };

  // Bare worktree root (`/<w>` / `/<w>/`) — the box picker; box class, no slug.
  if (seg2 === null) return { kind: "box", targetWorktree: name, targetBox: null };

  // `/<w>/<box>/...` — a box-scoped request; the slug is the target box.
  return { kind: "box", targetWorktree: name, targetBox: seg2 };
}

// --- authorization ----------------------------------------------------------

function wantsHtml(headers: RouterHeaders): boolean {
  const accept = headers["accept"];
  const value = typeof accept === "string" ? accept : "";
  return value.includes("text/html");
}

/** A browser navigation (as opposed to an API fetch or a curl call). */
function isNavigation(method: string, headers: RouterHeaders): boolean {
  return method === "GET" && wantsHtml(headers);
}

function deny(args: {
  status: 401 | 403 | 404;
  reason: string;
  redirectToLogin: boolean;
  route: RouterRoute;
}): RouterAuthDecision {
  return { allow: false, ...args };
}

/**
 * Decide allow/deny for one dev-router request. Pure over its inputs + injected
 * deps; the resolvers it calls depend on the route class, so only the needed
 * I/O runs in chunk 2 (e.g. a control read never touches the box map).
 */
export async function authorizeRouterRequest(
  input: RouterAuthInput,
  deps: RouterAuthDeps,
): Promise<RouterAuthDecision> {
  const { trustedLocal, method, url, headers } = input;
  const route = classifyRouterRoute({ method, url });

  // The UDS is a real capability boundary: a browser cannot originate a UDS
  // request, so arriving on it IS local trust. Allow all (local dev ergonomics).
  if (trustedLocal) return { allow: true, route };

  const nav = isNavigation(method, headers);

  switch (route.kind) {
    case "unauth-allowlist":
      return { allow: true, route };

    case "control": {
      // Mutating control: owner session AND a CSRF-safe origin.
      const owner = await deps.resolveOwnerSession(headers);
      if (!owner) {
        return deny({ status: 401, reason: "owner-session-required", redirectToLogin: nav, route });
      }
      if (!(await deps.isCsrfSafe(headers))) {
        // Owner is present but the request's origin is cross-site — a CSRF
        // attempt (e.g. a form POST from another origin). Never redirect.
        return deny({ status: 403, reason: "csrf-check-failed", redirectToLogin: false, route });
      }
      return { allow: true, route };
    }

    case "control-read": {
      const owner = await deps.resolveOwnerSession(headers);
      if (!owner) {
        // `/__router/status` (json) is a machine endpoint — never redirect it;
        // the `/` and `/dev/` browser pages redirect a navigation to login.
        return deny({
          status: 401,
          reason: "owner-session-required",
          redirectToLogin: route.json ? false : nav,
          route,
        });
      }
      return { allow: true, route };
    }

    case "box": {
      // Single slug→box source of truth; unknown/ambiguous slug ⇒ fail closed.
      const targetBoxRoot = await deps.resolveTargetBoxRoot(route);
      if (targetBoxRoot === null) {
        return deny({ status: 401, reason: "target-box-unresolved", redirectToLogin: nav, route });
      }
      // The box precedence ladder for the TARGET box: agent bearer → per-box
      // mobile auth → session identity with box access.
      if (await deps.isAgentBearer(headers)) return { allow: true, route };
      if (await deps.resolveMobileForBox(headers, targetBoxRoot)) return { allow: true, route };
      if (await deps.resolveBoxAccessSession(headers, targetBoxRoot)) return { allow: true, route };
      return deny({ status: 401, reason: "box-auth-required", redirectToLogin: nav, route });
    }

    case "unknown":
      // Not a recognized route — the router already 404s unknown worktrees; a
      // navigation to a login page would be misleading, so deny flatly (404).
      return deny({ status: 404, reason: "unknown-route", redirectToLogin: false, route });

    default:
      return assertNever(route);
  }
}

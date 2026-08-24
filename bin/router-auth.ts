// The dev router's fail-closed authorization core (Track B, chunk 1 of
// callback-box/docs/implemented-plans/expose-dev-router.md).
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
import { isScanUploadSubpath } from "../callback-box/src/hub/scan-gate.js";
import { isPairingRedeemUrl } from "../callback-box/src/webapp/routes/pairing.js";

/**
 * The router-scoped variant of `isPairingRedeemUrl`. The shared matcher is
 * anchored to the box-only shape (`/<box>/api/pairing/redeem`) the hub and box
 * servers see — deliberately, per
 * issues/closed/code-quality/2026-07-19-mobile-contract-small-cleanups.md,
 * which tightened it away from an unbounded `endsWith` match. The router sees
 * requests un-stripped (`/<worktree>/<box>/...`), one segment deeper, so it
 * needs its own anchor rather than reusing the box-level one — widening the
 * shared matcher to accept two segments would re-open the imprecision that
 * fix closed for the hub/box servers.
 */
function isRouterPairingRedeemUrl(pathname: string): boolean {
  return isPairingRedeemUrl(pathname) || /^\/[^/]+\/[^/]+\/api\/pairing\/redeem$/.test(pathname);
}

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
 *   favicons, the pre-auth iOS pairing-redeem POST, and the scan-upload
 *   surface (`POST /<w>/<box>/api/scan/check`, `PUT
 *   /<w>/<box>/api/scan/files/<sha256>`) whose scan-token bearer the hub's
 *   scan gate and the box child each verify independently.
 * - `control`: MUTATING router control (`/__router/{stop,retry}` and the
 *   dashboard cold-start) — owner session AND a CSRF-safe origin.
 * - `control-read`: read-only router infra (`/__router/status` and the `/`
 *   worktree index) — owner session, no CSRF requirement.
 *   `json` distinguishes the machine endpoint (`/__router/status`, always a JSON
 *   401 on deny) from the browser pages (which redirect a navigation to login).
 * - `dev-read`: the bare and per-worktree `/dev/` browsers — owner session OR
 *   the machine-wide browse key. These are agent-authored, read-only surfaces;
 *   the browse key already grants the same agent every box and Vite asset.
 * - `worktree-box-list`: the hub's `GET /<w>/api/boxes` endpoint. Reachable by
 *   any valid credential in the worktree because the hub performs the
 *   credential-to-box filtering before returning the list.
 * - `box`: a per-box or root-worktree app request (`/<w>/<box>/...`, other
 *   `/<w>/api/*`, `/<w>/`) — the box precedence ladder against the TARGET box.
 * - `worktree-asset`: a NON-SENSITIVE worktree-root dev asset Vite serves itself
 *   (`/<w>/@vite/...`, `/<w>/@fs/...`, `/<w>/@id/...`, `/<w>/@react-refresh`,
 *   `/<w>/node_modules/...`, `/<w>/src/...`) — the dev SPA shell an iOS webview
 *   needs. Reachable by ANY valid box credential in the worktree (a session, OR a
 *   per-box mobile token for any box there), NOT the cross-box picker or other
 *   root APIs, which stay session-only. These paths never serve box data —
 *   Vite owns them, so a box literally named `src`/`node_modules` is already
 *   unreachable in dev anyway (this classification mirrors the proxy's real
 *   routing). Built `assets`/`icons` are separately in `unauth-allowlist`.
 * - `unknown`: anything else — deny (fail closed).
 */
export type RouterRoute =
  | { kind: "unauth-allowlist" }
  | { kind: "control" }
  | { kind: "control-read"; json: boolean }
  | { kind: "dev-read" }
  | { kind: "worktree-box-list"; targetWorktree: string }
  | ({ kind: "box" } & BoxTarget)
  | { kind: "worktree-asset"; targetWorktree: string }
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
 * - `isBrowseKey` — the machine-wide local-dev browser key. Unlike an agent
 *   bearer, this credential is not scoped to a target box.
 * - `isCsrfSafe` — Origin / Sec-Fetch-Site same-origin assertion for mutating
 *   control.
 * - `resolveWorktreeAsset` — true if ANY valid box credential in the worktree is
 *   present: a session (owner, or a member of any box there), OR a per-box mobile
 *   token / agent bearer for any box there. Gates the non-sensitive dev assets
 *   without demanding the cross-box picker's per-user session. The box-list
 *   route reuses this resolver only as a worktree credential gate; the hub
 *   still filters the response to boxes authorized by that credential.
 */
export interface RouterAuthDeps {
  resolveOwnerSession(headers: RouterHeaders): Awaitable<OwnerIdentity | null>;
  resolveTargetBoxRoot(target: BoxTarget): Awaitable<string | null>;
  resolveBoxAccessSession(headers: RouterHeaders, targetBoxRoot: string): Awaitable<BoxAccessIdentity | null>;
  resolveMobileForBox(headers: RouterHeaders, targetBoxRoot: string): Awaitable<boolean>;
  isAgentBearer(headers: RouterHeaders): Awaitable<boolean>;
  isBrowseKey(headers: RouterHeaders): Awaitable<boolean>;
  isCsrfSafe(headers: RouterHeaders): Awaitable<boolean>;
  resolveWorktreeAsset(headers: RouterHeaders, targetWorktree: string): Awaitable<boolean>;
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

/**
 * The Vite-internal / source-tree first segments under `/<w>/` that Vite serves
 * itself (NOT proxied to a box): its own module runtime plus the app source and
 * bundled deps. A box slug can never be one of these — Vite already shadows
 * them in dev — so treating them as non-sensitive worktree assets matches how
 * the proxy actually routes. Deliberately narrow (the plan's blessed set): no
 * wildcards, no `api`/`auth`/box paths, nothing that can serve box data.
 */
const VITE_DEV_ASSET_SEGMENTS = new Set<string>([
  "@vite",
  "@fs",
  "@id",
  "@react-refresh",
  "node_modules",
  "src",
]);

/** Public frontend static-asset paths (Track A rewrites these under `<prefix>/`). */
function isPublicFrontendAssetPath(rest: string): boolean {
  return (
    rest === "/manifest.webmanifest" ||
    rest === "/sw.js" ||
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

  // The pre-auth iOS pairing bootstrap. Router-scoped: the router sees the
  // request un-stripped, one segment deeper than the hub/box servers do — see
  // isRouterPairingRedeemUrl. The ticket is the credential.
  if (method === "POST" && isRouterPairingRedeemUrl(pathname)) return { kind: "unauth-allowlist" };

  // Router infra at the bare root (never under a worktree).
  if (pathname === "/" || pathname === "") return { kind: "control-read", json: false };
  if (pathname === "/favicon.png" || pathname === "/favicon.ico") return { kind: "unauth-allowlist" };
  if (pathname === "/__router" || pathname.startsWith("/__router/")) return classifyRouterControl(pathname);
  if (pathname === "/workstreams" || pathname.startsWith("/workstreams/")) {
    if (method === "GET" || method === "HEAD") return { kind: "control-read", json: false };
    if (
      method === "POST" &&
      (pathname.startsWith("/workstreams/action/") ||
        pathname.startsWith("/workstreams/issues/action/") ||
        pathname === "/workstreams/api/trpc" ||
        pathname.startsWith("/workstreams/api/trpc/"))
    )
      return { kind: "control" };
    return { kind: "unknown" };
  }
  // Bare `/dev` / `/dev/` redirect to `/main/dev/` — the agent-readable dev browser.
  if (pathname === "/dev" || pathname === "/dev/") return { kind: "dev-read" };

  const name = firstSegment(pathname);
  if (name === null) return { kind: "unknown" };
  const rest = pathname.slice(`/${name}`.length); // "" | "/..." after the worktree segment

  // `/<w>/auth/*` — login/setup HTML + the auth API (login, logout, me, methods,
  // callback). Method-agnostic: login is a POST, `/auth/me` a GET.
  if (rest === "/auth" || rest.startsWith("/auth/")) return { kind: "unauth-allowlist" };

  // `/<w>/{assets,icons,manifest.webmanifest,sw.js}` — public frontend static assets (GET).
  if (method === "GET" && isPublicFrontendAssetPath(rest)) return { kind: "unauth-allowlist" };

  // `/<w>/dev` / `/<w>/dev/...` — the worktree's agent-readable dev browser.
  if (rest === "/dev" || rest.startsWith("/dev/")) return { kind: "dev-read" };

  const seg2Match = rest.match(/^\/([^/]+)(?:\/|$)/);
  const seg2 = seg2Match ? seg2Match[1]! : null;

  // `/<w>/{@vite,@fs,@id,@react-refresh,node_modules,src}/...` — Vite-served dev
  // assets (GET). Reachable by ANY box credential in the worktree, so an iOS
  // webview holding only a per-box mobile token can load the dev SPA shell.
  if (method === "GET" && seg2 !== null && VITE_DEV_ASSET_SEGMENTS.has(seg2)) {
    return { kind: "worktree-asset", targetWorktree: name };
  }

  // The hub filters this list to boxes authorized by the request credential.
  // It must therefore be reachable before the frontend knows which box slug
  // that credential belongs to.
  if (method === "GET" && rest === "/api/boxes") {
    return { kind: "worktree-box-list", targetWorktree: name };
  }

  // Root-worktree API (`/<w>/api/*`) — box class, no single box slug in the path.
  if (seg2 === "api") return { kind: "box", targetWorktree: name, targetBox: null };

  // Bare worktree root (`/<w>` / `/<w>/`) — the box picker; box class, no slug.
  if (seg2 === null) return { kind: "box", targetWorktree: name, targetBox: null };

  // `/<w>/<box>/api/scan/{check,files/<sha256>}` — the scan-upload surface,
  // matched by the REUSED hub shape matcher with the method pinned to the
  // contract's verb per path. Like the pairing redeem above, the router
  // forwards on shape alone: the scan bearer is the credential, verified
  // independently by the hub's scan gate AND the box child's scan-auth
  // preHandler. A scan path with the wrong verb falls through to the normal
  // box wall.
  const boxRest = rest.slice(`/${seg2}`.length);
  if (isScanUploadSubpath(boxRest)) {
    const wantsCheck = boxRest === "/api/scan/check";
    if ((wantsCheck && method === "POST") || (!wantsCheck && method === "PUT")) {
      return { kind: "unauth-allowlist" };
    }
  }

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

    case "dev-read": {
      if (await deps.resolveOwnerSession(headers)) return { allow: true, route };
      if (await deps.isBrowseKey(headers)) return { allow: true, route };
      return deny({ status: 401, reason: "owner-or-browse-key-required", redirectToLogin: nav, route });
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

    case "worktree-box-list": {
      // The hub is the data-authorization boundary for this endpoint: it
      // verifies the same credential against every configured box and returns
      // only matches. The router only establishes that the credential belongs
      // to this worktree so the request can reach that filter.
      if (await deps.resolveWorktreeAsset(headers, route.targetWorktree)) return { allow: true, route };
      return deny({ status: 401, reason: "worktree-box-list-auth-required", redirectToLogin: nav, route });
    }

    case "worktree-asset": {
      // Non-sensitive Vite dev asset: ANY valid box credential in the worktree
      // (session OR a per-box mobile token/agent bearer for any box there).
      if (await deps.resolveWorktreeAsset(headers, route.targetWorktree)) return { allow: true, route };
      return deny({ status: 401, reason: "worktree-asset-auth-required", redirectToLogin: nav, route });
    }

    case "unknown":
      // Not a recognized route — the router already 404s unknown worktrees; a
      // navigation to a login page would be misleading, so deny flatly (404).
      return deny({ status: 404, reason: "unknown-route", redirectToLogin: false, route });

    default:
      return assertNever(route);
  }
}

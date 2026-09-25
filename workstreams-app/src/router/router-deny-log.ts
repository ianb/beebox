// What a refused request gets back, and what it leaves behind.
//
// `deny()` in router-auth.ts is a pure function that returns a decision and logs
// nothing, so before this module a refused request left no trace at all — which
// is why an `owner-session-required` reported from iOS on 2026-09-15 is still
// unexplained (issues/bugs/2026-09-15-dev-router-transient-failures-are-permanent-and-unlogged.md).
// `deny()` stays pure; the logging happens where a decision is CONSUMED, so
// `authorizeRouterRequest` remains unit-testable without a logger.
//
// There are two consumers, and only one of them used to say anything at all:
// `writeDeny` below renders the HTTP denial, while a refused WebSocket upgrade
// was `socket.destroy()` with no output (router-upgrade.ts). An iOS client
// reconnecting during an outage upgrades rather than navigates, so the silent
// path was the likelier one.
//
// `writeDeny` and its guard-header helper moved here from router.ts when adding
// the logging pushed that file past its 300-line limit. They belong together:
// this module is the whole of what a denial does.

import type { RouterAuthDecision } from "./router-auth.js";
import { parseWorktreeName } from "./router-config.js";

/** A denial line names four fields and no more. */
export interface DenialFacts {
  method: string;
  url: string;
  decision: RouterAuthDecision & { allow: false };
}

/**
 * The path a denial line reports: the query string is DROPPED, never logged.
 *
 * Not tidiness — a credential lives there. `docs/mobile-contract.md` puts the
 * chat webview at `<baseURL>/chat?nativeComposer=1[&session=<id>][&mobileToken=<token>]`,
 * so logging a raw URL would write a live mobile token into a file whose entire
 * purpose is to be read later by whoever is debugging. The path alone answers
 * the question a post-mortem asks ("what did it request?") and the router's own
 * route classification is reported beside it.
 */
export function denialPath(url: string): string {
  const cut = url.search(/[?#]/u);
  const path = cut === -1 ? url : url.slice(0, cut);
  return path === "" ? "/" : path;
}

/** One denial, as one line. Pure, so the field list is pinned by a unit test
 *  rather than by reading the call sites. */
export function formatDenial({ method, url, decision }: DenialFacts): string {
  return `deny ${method} ${denialPath(url)} route=${decision.route.kind} reason=${decision.reason}`;
}

/**
 * One line per (reason, path) per window, for WebSocket-upgrade denials only.
 *
 * A browser or a native client reconnects a dropped socket on a timer, so an
 * unthrottled upgrade denial writes the same line every few seconds for as long
 * as the condition lasts — burying the log this work exists to make readable.
 * HTTP denials are not throttled: they are request-driven, not timer-driven.
 */
export const UPGRADE_DENIAL_WINDOW_MS = 10_000;

/** Above this many distinct keys the table is dropped wholesale rather than
 *  grown. A dev router sees a handful of denial shapes; a table that large means
 *  something is enumerating paths, and the throttle is not the right place to
 *  care about that. */
const MAX_TRACKED_KEYS = 256;

export class UpgradeDenialThrottle {
  private readonly lastLogged = new Map<string, number>();

  /** Whether to emit this denial now, recording it if so. */
  admit({ key, now }: { key: string; now: number }): boolean {
    const previous = this.lastLogged.get(key);
    if (previous !== undefined && now - previous < UPGRADE_DENIAL_WINDOW_MS) return false;
    if (this.lastLogged.size >= MAX_TRACKED_KEYS) this.lastLogged.clear();
    this.lastLogged.set(key, now);
    return true;
  }
}

// --- what a denial writes BACK --------------------------------------------
/**
 * The worktree segment to route a login redirect through. Login lives under a
 * worktree (`/<w>/auth/login`), so a bare router-infra path (`/`, `/dev`,
 * `/__router/*`) has none — fall back to `main`. A box or `/<w>/dev/` path
 * carries its own worktree in the first segment.
 */
function loginWorktree(url: string): string {
  const first = parseWorktreeName(url);
  if (!first || first === "dev" || first === "__router" || first === "workstreams") return "main";
  return first;
}

/** The request field `writeDeny` reads. Structural so a unit test can pass a
 *  plain object instead of casting one to `http.IncomingMessage`. */
export interface DenyRequest {
  url?: string | undefined;
}

/** The response methods `writeDeny` writes through. Structural for the same
 *  reason; a real `http.ServerResponse` satisfies it. */
export interface DenyResponse {
  writeHead(status: number, headers?: Record<string, string>): void;
  end(chunk?: string): void;
}

/**
 * Write the response for a denied (non-`trustedLocal`) request. A denied browser
 * NAVIGATION (302 → the prefixed login page, carrying `returnTo`) so the user can
 * log in and come back; everything else gets a small JSON body at the gate's
 * status (401 / 403 / 404). Nothing here cold-starts or serves — the deny is
 * terminal, upstream of all dispatch.
 */
export function writeDeny(
  req: DenyRequest,
  { res, decision }: { res: DenyResponse; decision: RouterAuthDecision & { allow: false } },
): void {
  const url = req.url || "/";
  // Self-identify as a GUARDED dev router on denials of our own `/__router/*`
  // control routes (Track C, expose-dev-router.md): a benign marker so
  // `bbx tailscale setup` can prove the gate is live end-to-end over Serve
  // (401 + this header) and distinguish us from an ungated router (200, no
  // header) or a non-router. Leaks nothing a bare curl doesn't already learn.
  const guardHeaders = routerGuardHeaders(url);
  if (decision.redirectToLogin) {
    const location = `/${loginWorktree(url)}/auth/login?returnTo=${encodeURIComponent(url)}`;
    res.writeHead(302, { location, ...guardHeaders });
    res.end();
    return;
  }
  res.writeHead(decision.status, { "content-type": "application/json; charset=utf-8", ...guardHeaders });
  res.end(`${JSON.stringify({ error: decision.reason })}\n`);
}

/** The `x-bbx-router-guarded: 1` marker for a denial of a `/__router/*` control
 *  route, else no extra headers. Pure over the request path so it is unit-tested
 *  directly (workstreams-app/test/router/router-guard-header.test.ts). */
export function routerGuardHeaders(url: string): Record<string, string> {
  const q = url.indexOf("?");
  const pathname = q === -1 ? url : url.slice(0, q);
  return pathname === "/__router" || pathname.startsWith("/__router/") ? { "x-bbx-router-guarded": "1" } : {};
}

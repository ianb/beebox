/**
 * Target-posture classification for `bbx tailscale setup`/`status` (Track B).
 *
 * Before Tailscale Serve is pointed at a loopback port — and again when `status`
 * reports a live mapping — we must PROVE the loopback target is an auth-gated
 * beebox, not something we'd hand the whole tailnet unauthenticated. This
 * module is the single fail-closed classifier both callers share.
 *
 * Two postures clear exposure: `{ kind: "enforced" }` (a normal auth-gated bbx
 * serve/hub) and `{ kind: "router-guarded" }` (a Track-B dev router whose gate
 * denies anonymous `/__router/*` with 401 + the `x-bbx-router-guarded` header).
 * Everything else fails closed:
 *
 *   - **router**: the loopback port is an UNGATED dev router (`/__router/status`
 *     answers 200 with its status JSON, a pre-Track-B build) — refuse and tell
 *     the operator to update the router so its gate is live.
 *   - **non-loopback**: the same port also answers on a non-internal interface,
 *     so the server is bound to a public address, not just 127.0.0.1.
 *   - **ambiguous**: `/auth/me` did not match the EXACT shapes beebox
 *     emits (open `{open:true}`, a `{error:…}` 401, or an authenticated-user
 *     body) — refuse rather than assume it is protected.
 */

import { isRecord } from "../lib/is-record.js";
import type { ProbeResult, TailscaleDeps } from "./tailscale.js";

/** The running target's effective auth posture, from a loopback `/auth/me` probe. */
export type AuthPosture = "enforced" | "open" | "unreachable" | "ambiguous";

/**
 * Classify a loopback `/auth/me` probe against the EXACT shapes beebox's
 * `/auth/me` produces (`src/webapp/routes/auth.ts`):
 *   - open mode → `200 {"open":true}` ⇒ `open` (must NOT be exposed);
 *   - authenticated → `200` with `{email:<string>, isOwner:<bool>, boxes:<array>}`
 *     ⇒ `enforced`;
 *   - no session, auth required → `401 {"error":<string>}` ⇒ `enforced`;
 *   - no response ⇒ `unreachable`;
 *   - anything else (generic 401, random JSON with an `email`, a 302/HTML/SPA
 *     body, a 503) ⇒ `ambiguous`.
 * Every non-`enforced` outcome is a refusal — fail closed, no override flag.
 */
export function classifyAuthPosture(probe: ProbeResult): AuthPosture {
  if (!probe.reachable) return "unreachable";
  const body = parseJsonBody(probe.body);
  if (probe.status === 401) {
    // beebox's own unauthenticated answer is `{"error":"Not authenticated"}`;
    // a generic proxy 401 (HTML, empty, bare text) is NOT proof of a bbx wall.
    if (body !== null && typeof body["error"] === "string") return "enforced";
    return "ambiguous";
  }
  if (probe.status === 200 && body !== null) {
    if (body["open"] === true) return "open";
    if (isAuthenticatedMeBody(body)) return "enforced";
  }
  return "ambiguous";
}

function parseJsonBody(body: string | null | undefined): Record<string, unknown> | null {
  if (body === undefined || body === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (_e) {
    return null;
  }
  return isRecord(parsed) ? parsed : null;
}

/** The authenticated `/auth/me` body: a nonempty `email`, a boolean `isOwner`,
 *  and a `boxes` array — the full beebox shape, not just "has an email". */
function isAuthenticatedMeBody(body: Record<string, unknown>): boolean {
  return (
    typeof body["email"] === "string" &&
    body["email"].length > 0 &&
    typeof body["isOwner"] === "boolean" &&
    Array.isArray(body["boxes"])
  );
}

/**
 * The benign marker the Track-B dev router sets on its OWN anonymous 401 for a
 * `/__router/*` control route (`workstreams-app/src/router/router.ts`). It identifies "a guarded
 * callback dev router" and leaks nothing (a bare curl already learns the server
 * type). An UNGATED old router has no such header — it answers `/__router/status`
 * 200 with its status JSON. This lets the tailscale tooling distinguish a guarded
 * router (401 + header ⇒ the gate is live) from an ungated one (200) from a
 * non-router (anything else).
 */
const ROUTER_GUARDED_HEADER = "x-bbx-router-guarded";

function hasRouterGuardedHeader(probe: ProbeResult): boolean {
  return probe.headers?.[ROUTER_GUARDED_HEADER] === "1";
}

/** A `/__router/status` probe against a Track-B-guarded router: the fail-closed
 *  gate denies the anonymous request with 401 AND the self-identifying header. */
export function looksLikeGuardedRouter(probe: ProbeResult): boolean {
  return probe.reachable && probe.status === 401 && hasRouterGuardedHeader(probe);
}

/** Does a `/__router/status` probe carry an UNGATED dev router's status JSON?
 *  (200 + `routerPort` + `worktrees` — a pre-Track-B build with no auth gate.) */
function looksLikeUngatedRouter(probe: ProbeResult): boolean {
  if (!probe.reachable || probe.status !== 200) return false;
  const body = parseJsonBody(probe.body);
  if (body === null) return false;
  return typeof body["routerPort"] === "number" && isRecord(body["worktrees"]);
}

export type TargetPosture =
  | { kind: "enforced" }
  | { kind: "router-guarded" }
  | { kind: "open" }
  | { kind: "unreachable" }
  | { kind: "ambiguous" }
  | { kind: "router" }
  | { kind: "non-loopback"; address: string };

function loopbackHost(address: string): string {
  return address.includes(":") ? `[${address}]` : address;
}

/**
 * Classify a loopback target end-to-end: refuse the dev router, refuse a server
 * that also answers on a public interface, and read the `/auth/me` posture.
 * Every probe goes through the injected deps, so the whole thing is testable
 * with no network.
 */
export async function classifyTargetPosture(deps: TailscaleDeps, port: number): Promise<TargetPosture> {
  const loopback = `http://127.0.0.1:${port}`;

  // 1. Router detection. A Track-B-guarded router (anonymous 401 + the
  //    self-identifying header) is now an ALLOWED target — its fail-closed gate
  //    is live, so Serve fronting it hands the tailnet nothing unauthenticated.
  //    An UNGATED router (200 status JSON, pre-Track-B) is still refused.
  const routerProbe = await deps.probe(`${loopback}/__router/status`);
  if (looksLikeGuardedRouter(routerProbe)) return { kind: "router-guarded" };
  if (looksLikeUngatedRouter(routerProbe)) return { kind: "router" };

  // 2. Auth posture on loopback.
  const gate = classifyAuthPosture(await deps.probe(`${loopback}/auth/me`));
  if (gate === "unreachable") return { kind: "unreachable" };

  // 3. Non-loopback bind: if the SAME port answers on any non-internal address,
  //    the server is not loopback-only — refuse before exposing it further.
  for (const address of deps.networkInterfaces()) {
    const ext = await deps.probe(`http://${loopbackHost(address)}:${port}/auth/me`);
    if (ext.reachable) return { kind: "non-loopback", address };
  }

  if (gate === "enforced") return { kind: "enforced" };
  if (gate === "open") return { kind: "open" };
  return { kind: "ambiguous" };
}

/** The human refusal message for a posture that is NOT exposable. `enforced` and
 *  `router-guarded` are the two exposable postures, so they are excluded here —
 *  the caller handles them before reaching a refusal. */
export function describeRefusal(
  posture: Exclude<TargetPosture, { kind: "enforced" } | { kind: "router-guarded" }>,
  port: number,
): string {
  const probed = `http://127.0.0.1:${port}/auth/me`;
  switch (posture.kind) {
    case "open":
      // Defensive against an older/foreign server: current `bbx serve`/`bbx hub`
      // can no longer run unauthenticated (the open-mode opt-out was removed),
      // but a legacy or third-party server on this port might still report it.
      return (
        `REFUSING to expose loopback:${port} — it reports open (UNAUTHENTICATED) mode at ${probed}. ` +
        "Fronting it with Tailscale Serve would hand the whole tailnet an unauthenticated box. " +
        "Give the server real authentication first."
      );
    case "unreachable":
      return (
        `REFUSING to expose loopback:${port} — nothing answered at ${probed}. ` +
        "Start the auth-gated bbx serve/hub on that port first, then re-run `bbx tailscale setup`."
      );
    case "ambiguous":
      return (
        `REFUSING to expose loopback:${port} — ${probed} did not report a recognizable beebox auth ` +
        "posture (neither a `{error:…}` 401, nor an authenticated-user body, nor open mode). " +
        "Refusing to assume it is a protected beebox."
      );
    case "router":
      return (
        `REFUSING to expose loopback:${port} — it answers \`/__router/status\` 200 with the dev router's own ` +
        "status JSON, which means this router is NOT running the Track-B auth gate (a pre-Track-B build). " +
        "Update/rebuild the router so its gate denies anonymous access (a guarded router answers `/__router/status` " +
        "with 401), then re-run `bbx tailscale setup` — a guarded dev router is exposable, an ungated one is not."
      );
    case "non-loopback":
      return (
        `REFUSING to expose loopback:${port} — this server also answers on ${posture.address}:${port}, ` +
        "so it is bound to a public interface, not 127.0.0.1 only. Bind it to loopback before exposing it " +
        "over Tailscale (a non-loopback bind is already reachable without Serve)."
      );
    default:
      return posture;
  }
}

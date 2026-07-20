/**
 * Target-posture classification for `cb tailscale setup`/`status` (Track B).
 *
 * Before Tailscale Serve is pointed at a loopback port — and again when `status`
 * reports a live mapping — we must PROVE the loopback target is an auth-gated
 * callback-box, not something we'd hand the whole tailnet unauthenticated. This
 * module is the single fail-closed classifier both callers share. Three refusals
 * on top of the open/enforced/ambiguous auth-posture read:
 *
 *   - **router**: the loopback port is the dev router (`/__router/status`
 *     answers its own status JSON) — never a valid target.
 *   - **non-loopback**: the same port also answers on a non-internal interface,
 *     so the server is bound to a public address, not just 127.0.0.1.
 *   - **ambiguous**: `/auth/me` did not match the EXACT shapes callback-box
 *     emits (open `{open:true}`, a `{error:…}` 401, or an authenticated-user
 *     body) — refuse rather than assume it is protected.
 *
 * Only `{ kind: "enforced" }` clears exposure. Everything else fails closed.
 */

import { isRecord } from "../lib/is-record.js";
import type { ProbeResult, TailscaleDeps } from "./tailscale.js";

/** The running target's effective auth posture, from a loopback `/auth/me` probe. */
export type AuthPosture = "enforced" | "open" | "unreachable" | "ambiguous";

/**
 * Classify a loopback `/auth/me` probe against the EXACT shapes callback-box's
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
    // callback-box's own unauthenticated answer is `{"error":"Not authenticated"}`;
    // a generic proxy 401 (HTML, empty, bare text) is NOT proof of a cb wall.
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
 *  and a `boxes` array — the full callback-box shape, not just "has an email". */
function isAuthenticatedMeBody(body: Record<string, unknown>): boolean {
  return (
    typeof body["email"] === "string" &&
    body["email"].length > 0 &&
    typeof body["isOwner"] === "boolean" &&
    Array.isArray(body["boxes"])
  );
}

/** Does a `/__router/status` probe carry the dev router's status JSON? */
function looksLikeRouter(probe: ProbeResult): boolean {
  if (!probe.reachable || probe.status !== 200) return false;
  const body = parseJsonBody(probe.body);
  if (body === null) return false;
  return typeof body["routerPort"] === "number" && isRecord(body["worktrees"]);
}

export type TargetPosture =
  | { kind: "enforced" }
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

  // 1. Router rejection — the dev router is never a valid target.
  if (looksLikeRouter(await deps.probe(`${loopback}/__router/status`))) return { kind: "router" };

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

/** The human refusal message for a non-`enforced` posture. */
export function describeRefusal(posture: Exclude<TargetPosture, { kind: "enforced" }>, port: number): string {
  const probed = `http://127.0.0.1:${port}/auth/me`;
  switch (posture.kind) {
    case "open":
      return (
        `REFUSING to expose loopback:${port} — it reports open (UNAUTHENTICATED) mode at ${probed}. ` +
        "Fronting it with Tailscale Serve would hand the whole tailnet an unauthenticated box. " +
        "Unset CB_ALLOW_UNAUTHENTICATED and give the server real auth first."
      );
    case "unreachable":
      return (
        `REFUSING to expose loopback:${port} — nothing answered at ${probed}. ` +
        "Start the auth-gated cb serve/hub on that port first, then re-run `cb tailscale setup`."
      );
    case "ambiguous":
      return (
        `REFUSING to expose loopback:${port} — ${probed} did not report a recognizable callback-box auth ` +
        "posture (neither a `{error:…}` 401, nor an authenticated-user body, nor open mode). " +
        "Refusing to assume it is a protected callback-box."
      );
    case "router":
      return (
        `REFUSING to expose loopback:${port} — it answers \`/__router/status\` with the dev router's own ` +
        "status JSON. The dev router fronts every worktree and is never a valid Tailscale target; " +
        "point --target at a specific auth-gated cb serve/hub port instead."
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

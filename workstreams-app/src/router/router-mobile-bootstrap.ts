import type { IncomingHttpHeaders } from "node:http";

import type { RouterAuthDecision } from "./router-auth.js";
import { rewriteMobileCookiePath } from "./router-cookie.js";

export interface MobileBootstrapTarget {
  authorization: string;
  boxSlug: string;
  worktree: string;
}

interface RequestFacts {
  method?: string | undefined;
  url?: string | undefined;
  headers: IncomingHttpHeaders;
}

/**
 * A bearer-authenticated document navigation gets the Vite HTML shell rather
 * than a response from the box, so the box has no opportunity to mint the
 * short-lived browser cookie. Native API requests remain bearer-only and must
 * not pay for a redundant session exchange.
 */
export function mobileBootstrapTarget(
  request: RequestFacts,
  decision: RouterAuthDecision,
): MobileBootstrapTarget | null {
  if (
    decision.allow === false ||
    decision.route.kind !== "box" ||
    decision.route.targetBox === null ||
    request.method !== "GET" ||
    typeof request.headers.authorization !== "string"
  ) {
    return null;
  }
  const pathname = (request.url ?? "").split("?")[0] ?? "";
  const boxBase = `/${decision.route.targetWorktree}/${decision.route.targetBox}`;
  if (pathname !== boxBase && pathname.startsWith(`${boxBase}/`) === false) {
    return null;
  }
  const boxPath = pathname.slice(boxBase.length);
  if (boxPath === "/api" || boxPath.startsWith("/api/")) {
    return null;
  }
  return {
    authorization: request.headers.authorization,
    boxSlug: decision.route.targetBox,
    worktree: decision.route.targetWorktree,
  };
}

/**
 * What the box said when asked to exchange a bearer for a browser session.
 *
 * A discriminated result rather than `string[] | null`, because the caller
 * genuinely branches on WHY (principle 5): a transient failure should retry
 * against the worktree's new generation, and a rejection should tell the device
 * to re-pair. Collapsing both into `null` is what made a port race read as a
 * revoked device pairing on 2026-09-15 — the device token was fine, and
 * `mobile-devices.secret.json` was written a minute later when the retry
 * succeeded.
 */
export type BootstrapOutcome =
  | { ok: true; cookies: string[] }
  /** Nobody competent answered: a dead port from a kill/restart race, the wrong
   *  process on the port, a 5xx, a timeout. Retrying re-resolves the handle. */
  | { ok: false; kind: "transient"; detail: string }
  /** The box itself said no. Retrying asks the same question again. */
  | { ok: false; kind: "rejected"; status: number; reason: string };

/** How much of the box's error body to quote back. Enough for its own sentence
 *  ("Mobile device token is invalid or revoked"), short enough that a stray HTML
 *  page from the wrong process cannot flood a response or the log. */
const MAX_REASON_BYTES = 200;

/**
 * The box's own words for a refusal or an outage. A pairing refusal carries one
 * sentence in `error`; the hub's box-unavailable 503 carries a code in `error`
 * and the sentence in `message` (`beebox/src/hub/box-unavailable.ts`), so the
 * sentence wins when both are present. Empty when the body said nothing.
 */
async function readReason(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  const trimmed = text.trim().slice(0, MAX_REASON_BYTES);
  if (trimmed === "") return "";
  try {
    const parsed: unknown = JSON.parse(trimmed);
    // `in` narrows the property to `unknown` without a cast — the same shape
    // `errnoCode` uses in router-effects.ts.
    if (typeof parsed === "object" && parsed !== null) {
      if ("message" in parsed && typeof parsed.message === "string") return parsed.message;
      if ("error" in parsed && typeof parsed.error === "string") return parsed.error;
    }
  } catch (_e) {
    /* not JSON — the raw text is the best answer available */
  }
  return trimmed;
}

/** `box returned <status>`, plus the box's own sentence when it gave one. */
async function describeStatus(response: Response): Promise<string> {
  const reason = await readReason(response);
  return `box returned ${String(response.status)}${reason === "" ? "" : `: ${reason}`}`;
}

/**
 * Ask the box to exchange the durable device bearer for its signed browser
 * session, then adapt the box-relative cookie path to the router's Vite base.
 * The router never signs a box credential itself.
 *
 * Only the box's own authentication verdicts (401/403) are `rejected`. Anything
 * else — a 404 from a process that is not this box, a 5xx, a refused connection
 * — is not an answer to the question asked, so it is `transient` and the caller
 * retries against a freshly resolved generation.
 */
export async function bootstrapMobileSessionCookie(opts: {
  authorization: string;
  backendPort: number;
  boxSlug: string;
  worktree: string;
}): Promise<BootstrapOutcome> {
  let response: Response;
  try {
    response = await fetch(
      `http://127.0.0.1:${opts.backendPort}/${encodeURIComponent(opts.boxSlug)}/api/pairing/session`,
      {
        method: "POST",
        headers: { authorization: opts.authorization },
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
  } catch (e) {
    // A dying port from a kill/restart race arrives here as ECONNREFUSED, and a
    // wedged one as an AbortError. Both are worth another attempt.
    return { ok: false, kind: "transient", detail: e instanceof Error ? e.message : String(e) };
  }

  if (response.status === 401 || response.status === 403) {
    const reason = await readReason(response);
    return { ok: false, kind: "rejected", status: response.status, reason: reason === "" ? `box returned ${String(response.status)}` : reason };
  }
  if (response.status !== 204) {
    // A closed or unstartable box says why (`box_closed`, `box_unavailable`);
    // the device sees that sentence instead of a bare status.
    return { ok: false, kind: "transient", detail: await describeStatus(response) };
  }

  const setCookie = response.headers.get("set-cookie") ?? undefined;
  const cookies = rewriteMobileCookiePath(setCookie, {
    worktree: opts.worktree,
    boxSlug: opts.boxSlug,
  });
  if (cookies === undefined) {
    // The box accepted the bearer and minted nothing. Retrying asks the same
    // question and gets the same answer, so this is a rejection, not a
    // transient — and it is reported as itself rather than as a bad token.
    return { ok: false, kind: "rejected", status: 204, reason: "box accepted the device token but set no session cookie" };
  }
  return { ok: true, cookies };
}

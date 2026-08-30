/**
 * The hub's health verdict, derived from per-box supervisor state.
 *
 * `/healthz` used to report the literal `status: "ok"` unconditionally while
 * the per-box statuses it carried were evaluated by nothing — so a fleet of
 * crash-looping children read as healthy (the Node 22→24 better-sqlite3 ABI
 * incident, 2026-07-16). This module turns those statuses into a verdict.
 *
 * Kept separate from `supervisor.ts` (which is at its 300-line cap) and from
 * `hub-server.ts` (routing/auth): the verdict is a pure function over
 * `BoxRuntimeStatus[]`, so it's unit-testable without a server or a child.
 */

import type { BoxRuntimeStatus, BoxRunStatus } from "./supervisor.js";
import { assertNever } from "../lib/invariant.js";

/** Whether the hub as a whole is serving. `"unhealthy"` (→ HTTP 503) if ANY
 *  box is broken; `"ok"` (→ 200) otherwise, including a fleet that's merely
 *  idle. A liveness verdict, not a readiness one — a single broken child does
 *  not mean the hub PROCESS should be restarted (see the canary route and
 *  `docs/health-checks.md` for the liveness/readiness split). */
export type HubVerdict = "ok" | "unhealthy";

/**
 * Is this box in a broken state right now? Dispatches exhaustively over
 * `BoxRunStatus` so a new run status can't silently be treated as healthy.
 *
 * - `running` — the supervisor proved HTTP readiness at launch, and its exit
 *   handler flips a crashed child off `running`; trusted as healthy. (A box
 *   that reaches `running` and then wedges its event loop while still holding
 *   its port is NOT caught here — an accepted residual, see the plan's
 *   NOT-in-scope; catching it needs an active probe.)
 * - `starting` — broken only if it has already failed at least once
 *   (`consecutiveFailures > 0`): that's a crash-loop in progress. A first,
 *   clean boot is `starting` with zero failures and is not broken.
 * - `stopped` — a lazy hub's normal resting state (idle-collected or never
 *   requested). Unknown, not broken. The passive verdict cannot tell an idle
 *   stopped box from a would-be-broken one; the canary route exists for that.
 * - `unhealthy` — the crash-loop budget is exhausted and latched. Broken.
 *
 * `restarts` is deliberately NOT consulted: it's a lifetime counter that never
 * resets, so a box that blipped once long ago would read broken forever.
 */
export function isBoxBroken(box: BoxRuntimeStatus): boolean {
  const status: BoxRunStatus = box.status;
  switch (status) {
    case "running":
      return false;
    case "starting":
      return box.consecutiveFailures > 0;
    case "stopped":
      return false;
    case "unhealthy":
      return true;
    default:
      return assertNever(status);
  }
}

/** `"unhealthy"` if any box is broken, else `"ok"`. */
export function hubVerdict(boxes: BoxRuntimeStatus[]): HubVerdict {
  return boxes.some(isBoxBroken) ? "unhealthy" : "ok";
}

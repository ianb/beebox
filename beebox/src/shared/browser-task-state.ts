/**
 * The lifecycle state of a browser-task card, derived from its fields. A
 * feed task is a standing subscription: `open | closed` alone cannot say
 * whether it has ever run or whether it is overdue. This is the one place
 * that judgment lives; the view, the dashboard, and the list procedure all
 * call it.
 *
 * Pure and isomorphic; the caller supplies the clock.
 */

import { isIso8601Duration, parseIso8601DurationMs } from "./iso-duration.js";

export type BrowserTaskState =
  | { kind: "closed" }
  | { kind: "never-scanned" }
  /** No cadence set: current after any scan, nothing to be due against. */
  | { kind: "scanned"; lastAt: string }
  | { kind: "current"; lastAt: string; dueAt: string }
  | { kind: "due"; lastAt: string; dueAt: string; overdueMs: number };

export interface BrowserTaskStateInput {
  status: unknown;
  /** The card's `last-upload`, an ISO instant, or absent. */
  lastUpload: unknown;
  /** The card's `rescan-after`, an ISO-8601 duration, or absent. */
  rescanAfter: unknown;
}

export function browserTaskState(input: BrowserTaskStateInput, nowMs: number): BrowserTaskState {
  if (input.status === "closed") return { kind: "closed" };
  const lastAt = typeof input.lastUpload === "string" ? input.lastUpload : null;
  const lastMs = lastAt === null ? Number.NaN : new Date(lastAt).getTime();
  if (lastAt === null || Number.isNaN(lastMs)) return { kind: "never-scanned" };
  const cadence = typeof input.rescanAfter === "string" && isIso8601Duration(input.rescanAfter) ? input.rescanAfter : null;
  if (cadence === null) return { kind: "scanned", lastAt };
  const dueMs = lastMs + parseIso8601DurationMs(cadence);
  const dueAt = new Date(dueMs).toISOString();
  if (nowMs >= dueMs) return { kind: "due", lastAt, dueAt, overdueMs: nowMs - dueMs };
  return { kind: "current", lastAt, dueAt };
}

/** One short line for a status row or a dashboard list. */
export function describeBrowserTaskState(state: BrowserTaskState): string {
  switch (state.kind) {
    case "closed":
      return "closed";
    case "never-scanned":
      return "never scanned";
    case "scanned":
      return "scanned, no cadence set";
    case "current":
      return `current, next due ${state.dueAt.slice(0, 10)}`;
    case "due": {
      const days = Math.floor(state.overdueMs / 86_400_000);
      return days === 0 ? "due today" : `due, ${String(days)} days overdue`;
    }
  }
}

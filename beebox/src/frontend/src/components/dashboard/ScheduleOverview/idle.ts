/**
 * A deferred run that found nothing to do is the ordinary quiet case, not a
 * wait: its precheck (or `bbx changes`/`bbx judge --or-skip`) looked and saw
 * nothing for the task. Only the other deferral reasons mean the run is held
 * back (Jev unavailable or over budget, a missing key).
 */

import type { RouterOutput } from "../../../lib/trpc/client";

type DeferReason = NonNullable<RouterOutput["scheduler"]["schedules"]["schedules"][number]["lastDeferReason"]>;

const IDLE_LABEL: Record<DeferReason, string | null> = {
  "no-change": "nothing to do",
  "no-pass": "nothing passed the check",
  budget: null,
  "jev-unavailable": null,
  unconfigured: null,
};

/** The plain label for a run that deferred because it found nothing to do, else null. */
export function idleLabel(result: string | null, reason: DeferReason | null | undefined): string | null {
  if (result !== "deferred" || reason === null || reason === undefined) return null;
  return IDLE_LABEL[reason];
}

/** A deferral's recorded text without its `<reason>: ` code prefix (`budget: the box used…` → `the box used…`). */
export function deferText(text: string, reason: DeferReason | null | undefined): string {
  const prefix = reason === null || reason === undefined ? null : `${reason}: `;
  return prefix !== null && text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

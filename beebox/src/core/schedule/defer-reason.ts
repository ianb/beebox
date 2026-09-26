/**
 * Why a scheduled `runs:` command deferred: the reason its defer marker
 * (`$BBX_DEFER_FILE`) names before it exits 75. `bbx changes --or-skip` writes
 * `no-change`; `bbx judge` writes the rest. The reason decides whether the
 * schedule's change cursor advances (`memory.ts`), and `bbx health` shows it
 * as `waiting: <reason>`. See docs/plans/notifications.md (Track D).
 */

export const DEFER_REASONS = ["no-change", "no-pass", "budget", "jev-unavailable", "unconfigured"] as const;
export type DeferReason = (typeof DEFER_REASONS)[number];

/** One line per reason, for health and the tick's console. */
export const DEFER_REASON_TEXT: Record<DeferReason, string> = {
  "no-change": "nothing changed since the last run",
  "no-pass": "nothing passed the judgment",
  budget: "the box used its daily Jev budget",
  "jev-unavailable": "Jev did not answer",
  unconfigured: "the box has no OpenRouter key for Jev",
};

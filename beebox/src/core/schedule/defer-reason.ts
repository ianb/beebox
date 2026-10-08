/**
 * Why a scheduled `runs:` command deferred: the reason its defer marker
 * (`$BBX_DEFER_FILE`) names before it exits 75. `bbx changes --or-skip` writes
 * `no-change`, as does a procedure whose prechecks all skip with no marker
 * from an inner command; `bbx judge` writes the rest. The reason decides whether the
 * schedule's change cursor advances (`memory.ts`). `bbx health` shows a run
 * that found nothing to do as `ok: <reason>`, and the others as `waiting: <reason>`. See docs/implemented-plans/notifications.md (Track D).
 */

export const DEFER_REASONS = ["no-change", "no-pass", "budget", "jev-unavailable", "unconfigured"] as const;
export type DeferReason = (typeof DEFER_REASONS)[number];

/** One line per reason, for health and the tick's console. */
export const DEFER_REASON_TEXT: Record<DeferReason, string> = {
  "no-change": "nothing to do",
  "no-pass": "nothing passed the judgment",
  budget: "the box used its daily Jev budget",
  "jev-unavailable": "Jev did not answer",
  unconfigured: "the box has no OpenRouter key for Jev",
};

/**
 * A deferral that found nothing to do (`no-change`, `no-pass`): the run looked
 * and the work was not there. Healthy and quiet, unlike the reasons that hold a
 * run back (budget, an unavailable judge, a missing key).
 */
export function foundNothingToDo(reason: DeferReason | null): boolean {
  return reason === "no-change" || reason === "no-pass";
}

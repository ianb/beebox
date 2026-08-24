/**
 * The vocabulary for "the checker never reached a verdict".
 *
 * A diagnostic reports what it knows at the resolution it knows it. A review
 * that ran out of turns, timed out, or returned nothing parseable has produced
 * a *non-answer* — which is not the same as "the work is wrong". Collapsing it
 * into a failure teaches readers to discount the signal (the maps were fine and
 * health said otherwise; see
 * `issues/bugs/2026-08-12-health-masks-review-step-turn-cap.md`).
 *
 * This module holds the words that cross process boundaries — the reason tags,
 * the CLI exit code, and the stderr line the scheduler recognizes — so the
 * procedure engine, the CLI, and the scheduler all name the same thing.
 * Strings only: no engine or scheduler imports, so both sides can depend on it.
 */

/**
 * Why no verdict was reached. Each tag points at a different fix: `max-turns`
 * and `max-budget` are *budget* problems (a cap set too low, or a judge prompt
 * that wanders), `timeout` is a liveness problem, `no-structured-output` means
 * the model answered but not in the shape asked for, and `unknown` is the
 * honest label for everything else.
 */
export type InconclusiveReason =
  | "max-turns"
  | "max-budget"
  | "timeout"
  | "no-structured-output"
  | "unknown";

/** Exit code for "the work ran; the check reached no verdict". */
export const INCONCLUSIVE_EXIT_CODE = 2;

/** Line prefix that marks an inconclusive run across a process boundary. */
export const INCONCLUSIVE_PREFIX = "Inconclusive:";

/**
 * One-line phrase for a reason, in the voice of the thing that happened
 * ("reached max turns (8)"), so it drops into a sentence.
 */
export function describeInconclusiveReason(
  reason: InconclusiveReason,
  context?: { maxTurns?: number; detail?: string },
): string {
  const maxTurns = context?.maxTurns;
  const detail = context?.detail;
  switch (reason) {
    case "max-turns":
      return maxTurns === undefined
        ? "reached its turn cap without a verdict"
        : `reached max turns (${String(maxTurns)})`;
    case "max-budget":
      return "reached its cost ceiling without a verdict";
    case "timeout":
      return "timed out before returning a verdict";
    case "no-structured-output":
      return "returned no parseable verdict";
    case "unknown":
      return detail === undefined || detail === ""
        ? "returned no verdict"
        : `returned no verdict: ${detail}`;
  }
}

/**
 * Classify a failed judge invocation from the error text the agent layer
 * surfaces. The `error_*` values are the SDK result subtypes that
 * `buildAgentResult` passes through verbatim; the structured-output phrases
 * are the literals `validateStructuredResult` emits. Anything else stays
 * `unknown` rather than being guessed into a category.
 */
export function classifyInconclusiveReason(error: string): InconclusiveReason {
  if (/error_max_turns|maximum number of turns/i.test(error)) return "max-turns";
  if (/error_max_budget|cost ceiling|budget/i.test(error)) return "max-budget";
  if (/timed out|timeout/i.test(error)) return "timeout";
  if (/structured output/i.test(error)) return "no-structured-output";
  return "unknown";
}

/**
 * The single stderr line an inconclusive procedure run prints, and the one
 * the scheduler matches on. Names the procedure, the step whose review didn't
 * conclude, why, and — the part that stops the misreading — that the work
 * itself completed.
 */
export function formatInconclusiveLine(params: {
  procedure: string;
  stepId: string;
  detail: string;
}): string {
  return `${INCONCLUSIVE_PREFIX} procedure ${params.procedure} — review of step ${params.stepId} ${params.detail}; work completed`;
}

/** The first `Inconclusive:` line in captured output, or null. */
export function findInconclusiveLine(text: string): string | null {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith(INCONCLUSIVE_PREFIX));
  return line ?? null;
}

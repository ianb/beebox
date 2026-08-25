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
export const INCONCLUSIVE_REASONS = [
  "max-turns",
  "max-budget",
  "timeout",
  "no-structured-output",
  "unknown",
] as const;

export type InconclusiveReason = (typeof INCONCLUSIVE_REASONS)[number];

/**
 * Exit code for "the work ran; the check reached no verdict".
 *
 * Not 2: that code is already spoken for by the migration harness, where it
 * means "the migration applied, with per-card failures" (`migrate.ts`,
 * `SOFT_FAILURE_EXIT`). Two meanings on one code is how a non-verdict gets
 * recorded as a success. 3 is unclaimed across the CLI.
 */
export const INCONCLUSIVE_EXIT_CODE = 3;

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

/**
 * The same line for `cb handle`, whose unjudged unit is a category bucket
 * rather than a procedure step. Same prefix, same closing clause, so one
 * matcher recognizes both.
 */
export function formatHandleInconclusiveLine(params: {
  category: string;
  detail: string;
}): string {
  return `${INCONCLUSIVE_PREFIX} handle ${params.category} — ${params.detail}; work completed`;
}

/**
 * The exact shape of a line this module produces — both variants above.
 *
 * The prefix alone is not enough to classify by: a command's *stdout* may
 * quote the word (a test fixture, an agent echoing its own diagnosis), and
 * reading that as "the check reached no verdict" would launder a real failure
 * into a non-answer. Matchers require the whole line, not the opening word.
 */
const INCONCLUSIVE_LINE_RE =
  /^Inconclusive: (?:procedure \S+ — review of step \S+ .*|handle \S+ — .*); work completed$/;

/** Whether `line` is exactly one of this module's inconclusive lines. */
function isInconclusiveLine(line: string): boolean {
  return INCONCLUSIVE_LINE_RE.test(line.trim());
}

/** The first full-shape inconclusive line in captured output, or null. */
export function findInconclusiveLine(text: string): string | null {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => isInconclusiveLine(l));
  return line ?? null;
}

/**
 * The `validate.error` prose a run card carries for an inconclusive check, and
 * its inverse. A pair, because `cb procedure resume` has to recover the reason
 * phrase from a run card written by an earlier process — the run card is the
 * only record of it — and a lone `format` invites re-deriving the shape by eye
 * at the read site.
 */
export function formatInconclusiveValidateError(detail: string): string {
  return `Review ${detail} — the work was not judged.`;
}

/** The detail phrase inside {@link formatInconclusiveValidateError}, or null. */
export function parseInconclusiveValidateError(error: string): string | null {
  const match = /^Review (.+) — the work was not judged\.$/.exec(error.trim());
  return match?.[1] ?? null;
}

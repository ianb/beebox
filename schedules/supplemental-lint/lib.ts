/**
 * The comparable form of an oxlint / madge report.
 *
 * Pure — run.ts owns running the commands — because the week-over-week diff is
 * only useful if identical findings compare equal. madge numbers its cycle
 * list, so one cycle appearing near the top renumbered every line below it and
 * the sweep reported 35 unchanged cycles as new (run 20260912-152524).
 */

/** madge's ordinal prefix: `7) a > b`. */
const MADGE_ORDINAL = /^\d+\) /u;

/** Lines that say the tool ran, not what it found. */
const NOISE = /^Finished in |^Processed \d+ files/u;

/**
 * One report's findings, in the form the baseline stores and the diff
 * compares: no blank lines, no pnpm banner, no per-run timings, and no
 * position-dependent numbering.
 */
export function reportLines(output: string): string[] {
  return output.split("\n")
    .map((line) => line.trimEnd().replace(MADGE_ORDINAL, ""))
    .filter((line) => line !== "" && !line.startsWith(">") && !line.includes("ELIFECYCLE"))
    .filter((line) => !NOISE.test(line));
}

/**
 * Findings this week's report has and last week's did not. Order follows the
 * current report so the handoff reads top-down; a line that merely moved is
 * not new.
 */
export function newLines(previous: readonly string[], current: readonly string[]): string[] {
  const known = new Set(previous);
  return current.filter((line) => !known.has(line));
}

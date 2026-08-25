import { INCONCLUSIVE_PREFIX, findInconclusiveLine } from "./inconclusive.js";

/**
 * Select the most actionable one-line diagnostic from scheduler error text.
 *
 * An `Inconclusive:` line wins outright, wherever it sits: it is the only line
 * that says the work completed and only the check fell short, and every other
 * candidate ("Command failed with exit code 2") reads as a plain failure.
 */
export function conciseScheduleError(error: string): string {
  const inconclusive = findInconclusiveLine(error);
  if (inconclusive !== null) return inconclusive;
  const lines = error.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headline = lines.find((line) => /^Command (?:failed|timed out)\b/.test(line));
  const stderrIndex = lines.indexOf("stderr:");
  if (stderrIndex !== -1) {
    const stdoutIndex = lines.indexOf("stdout:", stderrIndex + 1);
    const stderrLines = lines.slice(
      stderrIndex + 1,
      stdoutIndex === -1 ? undefined : stdoutIndex,
    );
    const stderrDiagnostic = stderrLines.toReversed().find(isScheduleDiagnostic);
    if (stderrDiagnostic !== undefined) return stderrDiagnostic;
    if (headline !== undefined) return headline;
    const stderrDetail = stderrLines.at(-1);
    if (stderrDetail !== undefined) return stderrDetail;
  }
  const diagnostic = lines.toReversed().find(isScheduleDiagnostic);
  return diagnostic ?? headline ?? lines.find((line) => line !== "stdout:")
    ?? "Unknown scheduled-task failure";
}

function isScheduleDiagnostic(line: string): boolean {
  return /^(?:Error:|Agent (?:failed|invocation failed):|Failed:|Deferred:|Inconclusive:|[A-Z][\dA-Z_]{2,}$)/.test(line);
}

/**
 * The console line for a completed scheduled run, given how it was classified.
 * An inconclusive `error` is already a full sentence starting with
 * `Inconclusive:` — prefixing it again would read `Inconclusive: Inconclusive:`.
 */
export function scheduleOutcomeLine(outcome: {
  result: "failure" | "deferred" | "inconclusive";
  error: string;
}): string {
  if (outcome.result === "inconclusive") {
    return outcome.error.startsWith(INCONCLUSIVE_PREFIX)
      ? outcome.error
      : `${INCONCLUSIVE_PREFIX} ${outcome.error}`;
  }
  return `${outcome.result === "deferred" ? "Deferred" : "Failed"}: ${outcome.error}`;
}

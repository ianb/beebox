/** Select the most actionable one-line diagnostic from scheduler error text. */
export function conciseScheduleError(error: string): string {
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
  return /^(?:Error:|Agent (?:failed|invocation failed):|Failed:|Deferred:|[A-Z][\dA-Z_]{2,}$)/.test(line);
}

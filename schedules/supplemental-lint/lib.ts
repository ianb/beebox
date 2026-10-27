/**
 * The comparable form of an oxlint report (`lint:oxlint` and the
 * `import/no-cycle` run behind `lint:circular`).
 *
 * Pure — run.ts owns running the commands — because the week-over-week diff is
 * only useful if identical findings compare equal. oxlint prints each finding's
 * path, line number and surrounding source, so moving a file or editing above a
 * finding re-reported it: run 20261003-193157 reported 21 unchanged warnings as
 * new after a directory reorganisation.
 */

/** Lines that say the tool ran, not what it found. */
const NOISE = /^Finished in |^Processed \d+ files|^Found \d+ warnings? and \d+ errors?\.$/u;

/** oxlint's finding header: `  ! unicorn(no-useless-spread): Using a spread …`. */
const OXLINT_HEADER = /^\s*[!x×] [\w-]+\([\w-]+\): /u;

/** oxlint's location line: `    ,-[src/a.ts:128:27]`. */
const OXLINT_LOCATION = /^\s*,-\[.*:(\d+):\d+\]$/u;

/** A finding's trailing `help:`/`note:` text, such as no-cycle's import-path diagram. */
const OXLINT_TRAILER = /^\s*(?:help|note): /u;

/** One source-excerpt line: ` 128 |     for (…) settle();`, with `,->`/`|`/`` `-> `` span markers. */
const OXLINT_SOURCE = /^\s*(\d+) \|(?: (?:,->|`->|\|))?(.*)$/u;

/**
 * One report's findings, in the form the baseline stores and the diff
 * compares: no blank lines, no pnpm banner, no per-run timings, and no
 * position-dependent numbering. Each oxlint finding becomes one line, its
 * header plus the flagged source line, so it keeps its identity when its file
 * moves or the code above it changes.
 */
export function reportLines(output: string): string[] {
  const lines: string[] = [];
  let finding: { header: string; line?: string | undefined; code?: string | undefined } | undefined;
  // After a finding's trailer starts, every line up to the blank one belongs to it.
  let inTrailer = false;
  const flush = (): void => {
    if (finding) lines.push(finding.code === undefined ? finding.header : `${finding.header} | ${finding.code}`);
    finding = undefined;
  };
  for (const raw of output.split("\n")) {
    const line = raw.trimEnd();
    if (OXLINT_HEADER.test(line)) {
      flush();
      inTrailer = false;
      finding = { header: line.trim() };
      continue;
    }
    if (inTrailer) {
      if (line === "") inTrailer = false;
      continue;
    }
    if (finding) {
      if (line === "" || OXLINT_TRAILER.test(line)) {
        inTrailer = line !== "";
        flush();
        continue;
      }
      const location = OXLINT_LOCATION.exec(line);
      if (location) finding.line = location[1];
      const source = OXLINT_SOURCE.exec(line);
      if (source && source[1] === finding.line && finding.code === undefined) finding.code = source[2]?.trim();
      continue;
    }
    lines.push(line);
  }
  flush();
  return lines
    .filter((line) => line !== "" && !line.startsWith(">") && !line.includes("ELIFECYCLE"))
    .filter((line) => !NOISE.test(line));
}

/**
 * Findings this week's report has more of than last week's. Order follows the
 * current report so the handoff reads top-down; a line that merely moved is
 * not new, but a second copy of a known finding is.
 */
export function newLines(previous: readonly string[], current: readonly string[]): string[] {
  const known = new Map<string, number>();
  for (const line of previous) known.set(line, (known.get(line) ?? 0) + 1);
  return current.filter((line) => {
    const count = known.get(line) ?? 0;
    known.set(line, count - 1);
    return count <= 0;
  });
}

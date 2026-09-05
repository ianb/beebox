/**
 * The full-suite schedule's alert texts: the red alert (culprits, flakes,
 * what was not bisected), the environment alert, and their titles. Split from
 * lib.ts for size; the wording rule they share is that the FIRST line says
 * what the reader should conclude — "nothing is broken", or "N files fail on
 * main" — and the rest is a labeled list. A flakes-only run must never read
 * as if the whole suite failed.
 */

import { BISECT_MAX_FILES, ENVIRONMENT_FAILURE_FILES, workstreamOf, type Culprit, type Landing } from "./lib.js";

/** `1 test file`, `2 test files`. */
export function count(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
}

function files(list: string[]): string {
  return list.map((file) => `\`${file}\``).join(", ");
}

/** The alert title for a run whose only failures re-ran green. */
export function flakesAlertTitle(flakes: string[]): string {
  return `full suite green after re-run: ${count(flakes.length, "flaky file")}`;
}

/** The alert title for a run with real failures, blamed or not. */
export function redAlertTitle(input: { real: string[]; culprits: Culprit[] }): string {
  const failing = `full suite: ${count(input.real.length, "file")} failing`;
  return input.culprits.length === 0
    ? `${failing}, no attributable landing`
    : `${failing}, blamed on ${count(input.culprits.length, "landing")}`;
}

/** The alert body for a batch with failures — one message covering every culprit. */
export function renderRedAlert(input: {
  testedCommit: string;
  baseCommit: string | null;
  landings: Landing[];
  culprits: Culprit[];
  flakes: string[];
  unattributed: string[];
  /** Why those files were not bisected — the budget, or no range to search. */
  unattributedReason?: string;
}): string {
  const realFiles = [...new Set([...input.culprits.flatMap((culprit) => culprit.files), ...input.unattributed])];
  const headline =
    realFiles.length === 0
      ? `**Nothing is broken.** ${count(input.flakes.length, "test file")} failed in the batched run and passed` +
        " again on an isolated re-run, so the failure is recorded as a flake and no issue was filed."
      : input.culprits.length > 0
        ? `**${count(realFiles.length, "test file")} fail on main**, bisected to ${count(input.culprits.length, "landing")}.`
        : `**${count(realFiles.length, "test file")} fail on main**, not attributable to a landing.`;
  const tested =
    `\`${input.testedCommit.slice(0, 8)}\`` +
    (input.baseCommit === null
      ? ""
      : ` (${count(input.landings.length, "landing")} since \`${input.baseCommit.slice(0, 8)}\`)`);
  const lines: string[] = [headline, "", `- **Tested:** main at ${tested}`];
  if (input.culprits.length > 0) {
    lines.push("- **Bisected to:**");
    for (const culprit of input.culprits) {
      lines.push(
        `  - \`${culprit.landing.commit.slice(0, 8)}\` (${workstreamOf(culprit.landing.subject) ?? "no workstream"}):` +
          ` ${files(culprit.files)}`,
      );
    }
  }
  if (input.unattributed.length > 0) {
    const reason = input.unattributedReason ?? `over the ${String(BISECT_MAX_FILES)}-file budget`;
    lines.push(`- **Failing, not bisected** (${reason}): ${files(input.unattributed)}`);
  }
  if (input.flakes.length > 0) {
    lines.push(`- **Flaky** (failed in the batch, passed on re-run; in the flake ledger, no issue): ${files(input.flakes)}`);
  }
  if (realFiles.length === 0 && input.flakes.length === 0) lines.push("- **Failing:** none");
  lines.push("");
  return lines.join("\n");
}

/** The alert body for a run that failed too broadly to be about the code. */
export function renderEnvironmentAlert(input: {
  testedCommit: string;
  failures: string[];
  cluster?: { directory: string; files: string[]; error: string } | null;
}): string {
  const cluster = input.cluster ?? null;
  const why =
    cluster === null
      ? `over the ${String(ENVIRONMENT_FAILURE_FILES)}-file bar`
      : `${String(cluster.files.length)} files under \`${cluster.directory}\` all failed with the same first error`;
  return [
    `**Environment failure, not a set of bugs.** ${String(input.failures.length)} test files failed in the batched` +
      ` full-suite run at \`${input.testedCommit.slice(0, 8)}\` — ${why}. Nothing was bisected and no`,
    "issue was filed; the run log has the output.",
    "",
    ...(cluster === null ? [] : [`- **Shared error:** ${cluster.error}`]),
    `- **First files:** ${files(input.failures.slice(0, 10))}`,
    "",
  ].join("\n");
}

/**
 * The pure half of the batched full-suite run: everything that can be decided
 * from data rather than from git, tap, or the filesystem.
 *
 * Kept separate from `run.ts` for the reason the ledger keeps
 * `test-ledger-lib.ts` separate from `test-ledger.ts`: the interesting parts —
 * which landings are in the batch, whether a red run is an environment
 * failure, where a binary search steps next, what an issue file says — are the
 * parts that must be right at 03:00, and none of them need a checkout to test.
 *
 * Design: callback-box/docs/plans/change-based-test-selection.md, revision
 * 2026-08-25, mechanism D.
 */

import type { LedgerRecord } from "../../bin/test-ledger-lib.js";

/** The `--source` value this schedule stamps on every record it produces. */
export const LEDGER_SOURCE = "full-suite";

/**
 * More failing files than this and the run is not reporting bugs, it is
 * reporting a broken machine — a bad install, a missing binary, the loader
 * block failing as one event. The plan's number ("more than ~20 files"): one
 * alert, no bisect, no issues.
 */
export const ENVIRONMENT_FAILURE_FILES = 20;

/**
 * A file whose recent flake share is at least this is treated as a flake even
 * when its isolated re-run also fails. Same bar the careful tier uses
 * (`CAREFUL_THRESHOLD`), restated rather than imported so the two can diverge
 * if the tier's bar ever moves for tier-specific reasons.
 */
export const KNOWN_FLAKE_SHARE = 0.25;

/** How many recent runs of a file the flake share is measured over. */
export const FLAKE_WINDOW = 40;

/**
 * How many real failures get bisected. Each one costs log2(landings) suite-file
 * runs, and a batch with a dozen genuinely new failures is a story about the
 * batch, not about twelve separate landings — the alert names the rest.
 */
export const BISECT_MAX_FILES = 5;

// ─── the batch ────────────────────────────────────────────────────────────

/** One first-parent commit on `main` — a `bin/land` merge, or a direct commit. */
export interface Landing {
  commit: string;
  subject: string;
}

/** Field and record separators for the `git log --format` the parser expects. */
export const LANDING_FIELD_SEPARATOR = "\u001F";
export const LANDING_RECORD_SEPARATOR = "\u001E";

/**
 * `git log --first-parent --reverse --format=%H%x1f%s%x1e <base>..<pinned>`,
 * oldest first.
 *
 * Unit-separated rather than line-split: a merge subject is one line today, but
 * a hand-written commit on `main` can carry anything, and a parser that splits
 * on newlines turns the second line of a subject into a landing with no commit.
 */
export function parseLandings(raw: string): Landing[] {
  const landings: Landing[] = [];
  for (const chunk of raw.split(LANDING_RECORD_SEPARATOR)) {
    const record = chunk.replace(/^\n/u, "");
    if (record.trim() === "") continue;
    const separator = record.indexOf(LANDING_FIELD_SEPARATOR);
    if (separator === -1) continue;
    landings.push({
      commit: record.slice(0, separator),
      subject: record.slice(separator + 1).trim(),
    });
  }
  return landings;
}

/**
 * The workstream a landing came from, read off `bin/land`'s merge subject.
 *
 * The merge commit carries no `Workstream:` trailer — the branch's own commits
 * do, and those are not on first-parent main — so the subject is the only place
 * on the first-parent line where the name appears. A direct commit to `main`
 * has no workstream, and null is the honest answer rather than a guess.
 */
export function workstreamOf(subject: string): string | null {
  const match = /^Merge branch '(?:worktree-)?([^']+)'/u.exec(subject);
  return match?.[1] ?? null;
}

/**
 * The commit this schedule last finished testing, or null if it never has.
 *
 * Red counts: a batch whose failures have been filed is tested, and re-testing
 * the same range every hour would file the same issues every hour. Runs that
 * did not complete (killed, crashed — anything outside exit 0/1) do not count,
 * because their file list is a fragment.
 */
export function lastTestedCommit(records: LedgerRecord[]): string | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (record === undefined || record.source !== LEDGER_SOURCE) continue;
    const exitCode = record.exitCode ?? 0;
    if (exitCode !== 0 && exitCode !== 1) continue;
    return record.commit;
  }
  return null;
}

// ─── classifying a red run ────────────────────────────────────────────────

export type FailureVerdict = "flake" | "real";

/** Whether the whole run is a broken environment rather than a set of bugs. */
export function isEnvironmentFailure(input: { failures: string[]; threshold?: number }): boolean {
  return input.failures.length > (input.threshold ?? ENVIRONMENT_FAILURE_FILES);
}

/**
 * What one failing file means, in the plan's order: an isolated re-run that
 * passes is a flake by definition (nothing changed between the two runs), and a
 * file the ledger already shows flaking is a flake even when it fails twice.
 */
export function classifyFailure(input: {
  isolatedPass: boolean;
  flakeShare: number;
  threshold?: number;
}): FailureVerdict {
  if (input.isolatedPass) return "flake";
  return input.flakeShare >= (input.threshold ?? KNOWN_FLAKE_SHARE) ? "flake" : "real";
}

// ─── bisect ───────────────────────────────────────────────────────────────

/**
 * The half-open search state over the batch's landings: `lo` is the earliest
 * landing that could be the culprit, `hi` the latest. The landing BEFORE index
 * 0 is known good (the schedule tested it green, or filed what was red there)
 * and index `hi` is known bad (the run that just failed is at the last landing).
 */
export interface BisectRange {
  lo: number;
  hi: number;
}

/**
 * The next landing to test, or null when the range has collapsed to its answer.
 *
 * A plain binary search over the first-parent list rather than `git bisect`:
 * `git bisect --first-parent` exists but drives its own checkout state machine,
 * and the thing being searched here is already an ordered array of a handful of
 * commits. Ordinary arithmetic is testable without a repository.
 */
export function bisectStep(range: BisectRange): number | null {
  if (range.lo >= range.hi) return null;
  return Math.floor((range.lo + range.hi) / 2);
}

/** The range after testing `index`: passing clears everything up to and
 *  including it, failing makes it the new upper bound. */
export function narrowBisect(input: { range: BisectRange; index: number; passed: boolean }): BisectRange {
  const { range, index } = input;
  return input.passed ? { lo: index + 1, hi: range.hi } : { lo: range.lo, hi: index };
}

/**
 * Drive the search to completion against a callback that says whether the file
 * passes at a given landing. Returns the index of the first landing at which it
 * fails — always a valid index, because `hi` starts known-bad.
 */
export async function bisect(input: {
  count: number;
  passesAt: (index: number) => Promise<boolean>;
}): Promise<number> {
  let range: BisectRange = { lo: 0, hi: input.count - 1 };
  for (;;) {
    const step = bisectStep(range);
    if (step === null) return range.lo;
    range = narrowBisect({ range, index: step, passed: await input.passesAt(step) });
  }
}

// ─── what gets written ────────────────────────────────────────────────────

/** One landing that a bisect blamed, with the files it broke. */
export interface Culprit {
  landing: Landing;
  files: string[];
  /** The tap output for those files, already trimmed to something readable. */
  excerpt: string;
}

/** `issues/bugs/YYYY-MM-DD-<slug>.md`, per issues/CLAUDE.md. */
export function issuePath(input: { date: string; landing: Landing }): string {
  const short = input.landing.commit.slice(0, 8);
  const workstream = workstreamOf(input.landing.subject);
  const slug = workstream === null ? `full-suite-red-${short}` : `full-suite-red-${slugify(workstream)}-${short}`;
  return `issues/bugs/${input.date}-${slug}.md`;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}

/**
 * The issue file. Written by a script, so it says only what a script knows: the
 * landing, the workstream, the files, and the tap excerpt. It states no
 * diagnosis and proposes no fix — the workstream's own agent does that.
 */
export function renderIssue(input: {
  date: string;
  landing: Landing;
  files: string[];
  excerpt: string;
  testedCommit: string;
  baseCommit: string;
}): string {
  const workstream = workstreamOf(input.landing.subject);
  const short = input.landing.commit.slice(0, 8);
  const plural = input.files.length === 1 ? "" : "s";
  const frontmatter = [
    "---",
    `title: "Full-suite red after ${input.landing.subject}: ${String(input.files.length)} test file${plural} failing"`,
    `workstream: ${workstream ?? "unattached"}`,
    "area: callback-box",
    "priority: important",
    "filed-by: agent",
    "discovered-by: agent",
    ...(workstream === null
      ? []
      : [`discovered-in: worktree-${workstream} — the hourly full-suite run on main`]),
    "---",
    "",
  ];
  const body = [
    "The hourly batched full-suite run (`schedules/full-suite/`) went red on `main` at",
    `\`${input.testedCommit.slice(0, 8)}\`. Bisecting the landings since the last tested`,
    `commit (\`${input.baseCommit.slice(0, 8)}\`) over first-parent \`main\` blames one landing:`,
    "",
    `- **Landing:** \`${short}\` — ${input.landing.subject}`,
    `- **Workstream:** ${workstream ?? "none (a direct commit to main)"}`,
    `- **Failing file${plural}:** ${input.files.map((file) => `\`${file}\``).join(", ")}`,
    "",
    "Each file failed in the batched run and failed again on an isolated re-run, so",
    "it is not a flake by the ledger's definition. Nothing has been fixed; this is a",
    "report.",
    "",
    "```",
    input.excerpt,
    "```",
    "",
    "Reproduce at the blamed landing:",
    "",
    "```bash",
    `git log -1 ${short}`,
    `pnpm --dir callback-box exec tap ${input.files.join(" ")}`,
    "```",
    "",
  ];
  return [...frontmatter, ...body].join("\n");
}

/** The alert body for a red batch — one message covering every culprit. */
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
  const lines: string[] = [
    `Full suite red on main at \`${input.testedCommit.slice(0, 8)}\`, over ${String(input.landings.length)} landing(s)` +
      `${input.baseCommit === null ? "" : ` since \`${input.baseCommit.slice(0, 8)}\``}.`,
    "",
  ];
  if (input.culprits.length > 0) {
    lines.push("Bisected to:", "");
    for (const culprit of input.culprits) {
      lines.push(
        `- \`${culprit.landing.commit.slice(0, 8)}\` (${workstreamOf(culprit.landing.subject) ?? "no workstream"}):` +
          ` ${culprit.files.join(", ")}`,
      );
    }
    lines.push("");
  }
  if (input.unattributed.length > 0) {
    const reason = input.unattributedReason ?? `over the ${String(BISECT_MAX_FILES)}-file budget`;
    lines.push(`Not bisected (${reason}): ${input.unattributed.join(", ")}`, "");
  }
  if (input.flakes.length > 0) {
    lines.push(`Recorded as flakes, no issue filed: ${input.flakes.join(", ")}`, "");
  }
  return lines.join("\n");
}

/** The alert body for a run that failed too broadly to be about the code. */
export function renderEnvironmentAlert(input: { testedCommit: string; failures: string[] }): string {
  return [
    `${String(input.failures.length)} test files failed in the batched full-suite run at` +
      ` \`${input.testedCommit.slice(0, 8)}\` — over the ${String(ENVIRONMENT_FAILURE_FILES)}-file bar, so this is`,
    "read as a broken environment rather than a set of bugs. Nothing was bisected and no",
    "issue was filed; the run log has the output.",
    "",
    `First files: ${input.failures.slice(0, 10).join(", ")}`,
    "",
  ].join("\n");
}

/**
 * The TAP block for one failing file: its `not ok` line plus the YAML
 * diagnostics under it, up to the next top-level result.
 *
 * The whole suite's output is megabytes and the run log already has it; an
 * issue and an alert want the few dozen lines that say what broke.
 */
export function failureExcerpt(input: { raw: string; file: string; maxLines?: number }): string {
  const maxLines = input.maxLines ?? 40;
  const lines = input.raw.split("\n");
  // Matched by parsing the line, not by building a regexp out of the file name:
  // a path is data, and a data-built pattern is both a lint error here and a
  // silent mismatch the moment a path contains a regexp metacharacter.
  const start = lines.findIndex((line) => /^not ok \d+ - (\S+)/u.exec(line)?.[1] === input.file);
  if (start === -1) return `(no TAP block found for ${input.file})`;
  const block = [lines[start] ?? ""];
  for (let i = start + 1; i < lines.length && block.length < maxLines; i++) {
    const line = lines[i] ?? "";
    if (/^(ok|not ok) \d+ - /u.test(line)) break;
    block.push(line);
  }
  return block.join("\n").trimEnd();
}

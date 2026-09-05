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
 * Design: beebox/docs/plans/change-based-test-selection.md, revision
 * 2026-08-25, mechanism D.
 */

import { homedir } from "node:os";
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
 * The other shape a broken machine takes: a whole directory failing as one
 * event. The plan names `test/frontend/*` — 13 files that die together when
 * the frontend loader block breaks — and 13 is under the 20-file bar, so the
 * count alone would bisect a loader failure into thirteen bogus issues.
 *
 * A directory alone is not enough evidence (a real bug in one module breaks its
 * neighbours too), so the cluster also has to fail the SAME way: identical
 * first error line across every file in it. That is what a loader or install
 * failure looks like and what a set of genuine bugs does not.
 */
export const ENVIRONMENT_CLUSTER_FILES = 5;

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
 * Read ONLY from the completion marker {@link completionMarker} writes after
 * both tiers have finished. The per-tier records cannot answer this: the run
 * writes one for `ordinary` and one for `careful`, so a run that died between
 * them would leave an ordinary record behind and mark the commit tested with
 * the careful tier never run — a whole tier silently skipped forever, since
 * the next batch starts after it.
 *
 * Red counts: a batch whose failures have been filed is tested, and re-testing
 * the same range every hour would file the same issues every hour. A marker
 * whose run did not complete (killed, crashed — anything outside exit 0/1)
 * does not count, because its file list is a fragment.
 */
export function lastTestedCommit(records: LedgerRecord[]): string | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (record === undefined || record.source !== LEDGER_SOURCE) continue;
    if (record.marker !== true) continue;
    const exitCode = record.exitCode ?? 0;
    if (exitCode !== 0 && exitCode !== 1) continue;
    return record.commit;
  }
  return null;
}

/** The tiers a completed batch covers, in the order the run does them. */
export const TIERS = ["ordinary", "careful"] as const;

/**
 * One exit status for the whole batch: the worst of the tiers, unless a tier
 * did not complete at all (a signal, a crashed harness — anything outside
 * 0/1, and a null status counts as one) — then that status, so the marker is
 * skipped by {@link lastTestedCommit} and the range is tested again next hour.
 */
export function batchExit(codes: Array<number | null>): number {
  let worst = 0;
  for (const code of codes) {
    const status = code ?? 2;
    if (status !== 0 && status !== 1) return status;
    worst = Math.max(worst, status);
  }
  return worst;
}

/**
 * The record that says "this commit has been through every tier".
 *
 * A marker rather than a field on the last tier's record: the ledger wrapper
 * runs one tier and knows nothing about the other, so only the schedule can
 * say both are done — and it can only say it here, after both returned.
 */
export function completionMarker(input: {
  commit: string;
  branch: string;
  treeHash: string;
  exitCode: number;
  tiers: string[];
  changed: string[];
  emptyFileset: string;
  now?: Date;
}): LedgerRecord {
  return {
    ts: (input.now ?? new Date()).toISOString(),
    commit: input.commit,
    branch: input.branch,
    treeHash: input.treeHash,
    mode: "full",
    source: LEDGER_SOURCE,
    marker: true,
    exitCode: input.exitCode,
    accounted: null,
    changed: input.changed,
    ranFiles: input.emptyFileset,
    implicated: input.emptyFileset,
    durations: {},
    failures: [],
    tiers: input.tiers,
  };
}

// ─── classifying a red run ────────────────────────────────────────────────

export type FailureVerdict = "flake" | "real";

/**
 * Whether the whole run is a broken environment rather than a set of bugs:
 * too many files to be about the code, or one directory failing identically.
 *
 * `firstErrors` maps a failing file to the first error line of its TAP block
 * ({@link firstErrorLine}); files with no readable error are never clustered,
 * since "no error line" is not evidence of a shared cause.
 */
export function isEnvironmentFailure(input: {
  failures: string[];
  firstErrors?: Record<string, string | null>;
  threshold?: number;
  clusterThreshold?: number;
}): boolean {
  if (input.failures.length > (input.threshold ?? ENVIRONMENT_FAILURE_FILES)) return true;
  return environmentCluster(input) !== null;
}

/**
 * The directory whose files all failed the same way, when there is one:
 * at least `clusterThreshold` failing files directly under it, every one with
 * the same non-empty first error line.
 */
export function environmentCluster(input: {
  failures: string[];
  firstErrors?: Record<string, string | null>;
  clusterThreshold?: number;
}): { directory: string; files: string[]; error: string } | null {
  const firstErrors = input.firstErrors;
  if (firstErrors === undefined) return null;
  const threshold = input.clusterThreshold ?? ENVIRONMENT_CLUSTER_FILES;
  const byDirectory = new Map<string, string[]>();
  for (const file of input.failures) {
    const directory = file.slice(0, file.lastIndexOf("/") + 1);
    if (directory === "") continue;
    byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), file]);
  }
  for (const [directory, files] of byDirectory) {
    if (files.length < threshold) continue;
    const errors = files.map((file) => firstErrors[file] ?? null);
    const [first] = errors;
    if (first === undefined || first === null || first === "") continue;
    if (errors.every((error) => error === first)) return { directory, files, error: first };
  }
  return null;
}

/**
 * The first line of a failing file's TAP diagnostics that says what went wrong.
 *
 * tap writes the failure as a YAML block under the `not ok` line; `error:` and
 * `message:` are where the cause lands, and a folded scalar (`error: >-`) puts
 * it on the following line. Anything else — a stack, a diff — is not compared,
 * because two files can share a cause without sharing a stack.
 */
export function firstErrorLine(input: { raw: string; file: string }): string | null {
  const block = failureExcerpt({ raw: input.raw, file: input.file, maxLines: 40 }).split("\n");
  for (let i = 0; i < block.length; i++) {
    const match = /^\s*(?:error|message):\s*(.*)$/u.exec(block[i] ?? "");
    if (match === null) continue;
    const value = (match[1] ?? "").trim();
    if (value !== "" && value !== ">-" && value !== "|-" && value !== ">" && value !== "|") {
      return value;
    }
    const folded = (block[i + 1] ?? "").trim();
    return folded === "" ? null : folded;
  }
  return null;
}

/** {@link firstErrorLine} for every failing file, keyed by file. */
export function firstErrorLines(input: { raw: string; files: string[] }): Record<string, string | null> {
  return Object.fromEntries(
    input.files.map((file) => [file, firstErrorLine({ raw: input.raw, file })]),
  );
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

export function unstageIssueArgs(paths: string[]): string[] {
  return ["restore", "--staged", "--", ...paths];
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
    `title: "Full-suite red: ${input.files.join(", ")}"`,
    `workstream: ${workstream ?? "unattached"}`,
    "area: beebox",
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
    // tap's YAML diagnostics name the runner's node binary and checkout under
    // the home directory; path-leak-check rejects a real `/Users/<name>` in any
    // tracked file, and a report the hook refuses is a report nobody reads.
    input.excerpt.replaceAll(homedir(), "~"),
    "```",
    "",
    "Reproduce at the blamed landing:",
    "",
    "```bash",
    `git log -1 ${short}`,
    `pnpm --dir beebox exec tap ${input.files.join(" ")}`,
    "```",
    "",
  ];
  return [...frontmatter, ...body].join("\n");
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

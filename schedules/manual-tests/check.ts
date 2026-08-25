/**
 * Did the triage agent do only what it was allowed to do — and commit what it
 * did.
 *
 * The agent cannot commit; this can. What it commits is bounded by the check
 * below rather than by trusting the agent's report: every path it claims must
 * be a real open-issue file, actually changed, and changed only by APPENDING
 * (the pre-existing bytes must still match as a prefix). Anything else exits
 * non-zero and the runner raises an `important` alert with the log tail.
 *
 * Left uncommitted, these edits rot: nobody sees them until someone runs
 * `git status` in the scheduled worktree, and the next week's run inherits a
 * dirty tree.
 *
 * TWO THINGS DIFFER from `bin/manual-tests-scheduled.sh`, which this replaces.
 *
 * The baseline is **HEAD**, not a directory copied before the run. The old
 * runner and its agent shared one checkout, so a filesystem snapshot worked.
 * Here the `run` script executes in the main checkout and the session in the
 * schedule's own worktree, so a snapshot taken by `run` would be of a different
 * tree. HEAD is the baseline that exists where the edits happen. It is very
 * slightly weaker — an issue file already modified-but-uncommitted in the
 * worktree gets swept into the commit alongside the agent's append — and that
 * is accepted: the tree belongs to this schedule alone, so the only way to
 * write it is a previous run of this same check. It is bounded by the reverse
 * check below: every dirty path under `issues/` must be one the agent reported,
 * and nothing outside `issues/` may be dirty at all.
 *
 * The TRIAGE line is read from the **run log** rather than from a captured
 * transcript, because the runner already streams the session's output there.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";

/** The worktree the session ran in — NOT this script's directory, which is the
 *  main checkout the tick fired from. */
const WORKTREE = process.cwd();

const CATEGORIES = ["bugs", "features", "code-quality", "docs-and-chores", "decisions", "exploration", "watch"];

/** Exactly the shape the prompt asks the agent to end with. */
const TRIAGE_PATTERN = /^TRIAGE: (clean|issues\/[A-Za-z0-9._/-]+(?:, issues\/[A-Za-z0-9._/-]+)*)\.?$/u;

function refuse(message: string): never {
  process.stderr.write(`manual-tests check: ${message}\n`);
  process.exit(1);
}

async function git(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = await execa("git", ["-C", WORKTREE, ...args], { reject: false });
  return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
}

/** The last TRIAGE line in the run log. Last, not first: the log also holds the
 *  suite's own output, and the agent's line is the final word. */
async function triageLine(): Promise<string> {
  const stateDir = process.env["SCHEDULE_STATE_DIR"];
  const runId = process.env["SCHEDULE_RUN_ID"];
  if (stateDir === undefined || runId === undefined) refuse("SCHEDULE_STATE_DIR/SCHEDULE_RUN_ID are not set");
  const log = await fs.readFile(path.join(stateDir, "runs", `${runId}.log`), "utf8");
  const matches = log.split("\n").map((line) => line.trim()).filter((line) => TRIAGE_PATTERN.test(line));
  const last = matches.at(-1);
  if (last === undefined) refuse("the session never printed a TRIAGE line");
  return last.replace(/\.$/u, "");
}

/** The file's content at HEAD, or null when HEAD does not have it (a new issue
 *  file, which is an append to nothing and always allowed). */
async function contentAtHead(issuePath: string): Promise<Buffer | null> {
  const result = await execa("git", ["-C", WORKTREE, "show", `HEAD:${issuePath}`], {
    reject: false,
    encoding: "buffer",
    // Without this execa eats the file's final newline, and every unchanged
    // file then reads as an append of exactly "\n".
    stripFinalNewline: false,
  });
  return result.exitCode === 0 ? Buffer.from(result.stdout) : null;
}

/**
 * `issues/<category>/<file>.md` and nothing else — checked as a whole path, not
 * as a prefix. Checking only the first two segments left `issues/bugs/../../x.md`
 * passing validation and then resolving anywhere in the tree, which the check
 * would go on to commit under the triage message. A symlink is refused for the
 * same reason: the bytes compared against HEAD must be the bytes at that path.
 */
async function assertOpenIssuePath(issuePath: string): Promise<void> {
  const segments = issuePath.split("/");
  const [prefix, category, file] = segments;
  const wellFormed = segments.length === 3
    && prefix === "issues"
    && category !== undefined
    && CATEGORIES.includes(category)
    && file !== undefined
    && file !== "." && file !== ".."
    && file.endsWith(".md")
    && path.normalize(issuePath) === issuePath;
  if (!wellFormed) refuse(`'${issuePath}' is not an open-issue markdown file`);
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(path.join(WORKTREE, issuePath));
  } catch (e) {
    refuse(`'${issuePath}' does not exist (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!stat.isFile()) refuse(`'${issuePath}' is not a regular file`);
}

async function validate(issuePaths: string[]): Promise<void> {
  for (const issuePath of issuePaths) {
    await assertOpenIssuePath(issuePath);
    let current: Buffer;
    try {
      current = await fs.readFile(path.join(WORKTREE, issuePath));
    } catch (e) {
      refuse(`'${issuePath}' does not exist (${e instanceof Error ? e.message : String(e)})`);
    }
    const before = await contentAtHead(issuePath);
    if (before === null) continue;
    if (before.equals(current)) refuse(`'${issuePath}' is unchanged since HEAD`);
    if (!current.subarray(0, before.length).equals(before)) {
      refuse(`'${issuePath}' was rewritten, not appended to`);
    }
  }
}

/**
 * Path-scoped `add`/`commit` (the `bin/CLAUDE.md` convention) so nothing else
 * in the tree is swept in under this message. Never pushes: landing the week's
 * triage is the boxholder's call.
 */
async function commit(issuePaths: string[]): Promise<void> {
  const runId = process.env["SCHEDULE_RUN_ID"] ?? "unknown";
  const added = await git(["add", "--", ...issuePaths]);
  if (added.exitCode !== 0) refuse(`git add failed: ${added.stderr}`);
  const message = [
    `docs(issues): weekly manual-test triage ${runId}`,
    "",
    "Written by the scheduled manual-test triage agent (append-only; verified",
    "by the schedule's `check` before commit).",
    "",
    `Updated: ${issuePaths.join(", ")}`,
  ].join("\n");
  // `-m` MUST precede `--`: everything after `--` is a pathspec, so putting the
  // message there makes git look for a file named after the commit message.
  const committed = await git(["commit", "--quiet", "-m", message, "--", ...issuePaths]);
  if (committed.exitCode !== 0) refuse(`git commit failed: ${committed.stderr || committed.stdout}`);
  console.log(`Committed triage edits: ${issuePaths.join(", ")}`);
}

/**
 * Every path the session left dirty, tracked or not. `-z` because a porcelain
 * line is ambiguous otherwise, and a rename's ORIGINAL path arrives as its own
 * NUL-terminated field.
 */
async function dirtyPaths(): Promise<string[]> {
  // `-uall`: without it an untracked DIRECTORY collapses to one entry, so a
  // brand-new issue file would be reported as `issues/features/` and match
  // nothing the agent claimed.
  const status = await git(["status", "--porcelain", "-z", "-uall"]);
  if (status.exitCode !== 0) refuse(`git status failed: ${status.stderr || status.stdout}`);
  const fields = status.stdout.split("\0").filter((field) => field !== "");
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    if (field === undefined) continue;
    const code = field.slice(0, 2);
    paths.push(field.slice(3));
    // `R`/`C` entries carry the source path as the next field; it is the same
    // change, not a second dirty path.
    if (code.startsWith("R") || code.startsWith("C") || code[1] === "R" || code[1] === "C") i += 1;
  }
  return paths;
}

/**
 * The report is checked against the tree, not taken on trust. An agent that
 * edited issue files and then said `clean` — or listed one of the three it
 * touched — used to pass silently, and the unlisted edits sat in the scheduled
 * worktree until the next week's run inherited them.
 */
async function assertTreeMatches(reported: string[]): Promise<void> {
  const dirty = await dirtyPaths();
  const outside = dirty.filter((entry) => !entry.startsWith("issues/"));
  if (outside.length > 0) {
    refuse(`the session left files outside issues/ modified: ${outside.join(", ")}`);
  }
  const expected = new Set(reported);
  const unlisted = dirty.filter((entry) => !expected.has(entry));
  if (unlisted.length > 0) {
    refuse(`the session modified issue files it did not report: ${unlisted.join(", ")}`);
  }
}

const line = await triageLine();
if (line === "TRIAGE: clean") {
  await assertTreeMatches([]);
  console.log("Triage reported clean; nothing to commit.");
  process.exit(0);
}
const paths = line.slice("TRIAGE: ".length).split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
await validate(paths);
await assertTreeMatches(paths);
await commit(paths);

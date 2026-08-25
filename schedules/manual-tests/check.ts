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
 * write it is a previous run of this same check.
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

async function validate(issuePaths: string[]): Promise<void> {
  for (const issuePath of issuePaths) {
    const [prefix, category] = issuePath.split("/");
    if (prefix !== "issues" || category === undefined || !CATEGORIES.includes(category) || !issuePath.endsWith(".md")) {
      refuse(`'${issuePath}' is not an open-issue markdown file`);
    }
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

const line = await triageLine();
if (line === "TRIAGE: clean") {
  console.log("Triage reported clean; nothing to commit.");
  process.exit(0);
}
const paths = line.slice("TRIAGE: ".length).split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
await validate(paths);
await commit(paths);

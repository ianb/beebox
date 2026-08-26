/**
 * The weekly smoke-tier review: gather, compare, decide whether to hand off.
 *
 * Everything here is I/O — reading the shared smoke log, asking git what landed
 * and what bugs were filed. The rule for "is there anything to review" and the
 * shape of the briefing live in ./lib.ts, where they are testable.
 *
 * Nothing here judges a step. `run` deciding that a step "looks unproductive"
 * would be the script reasoning about its own findings — see the schedule's
 * header, and `.claude/skills/cb-authoring-schedules`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";
import { parseRunRecord, smokeLogPath, summarizeSmokeLog } from "../../bin/smoke-lib.ts";
import { formatBriefing, hasSomethingToReview, parseBaseline, windowStart, type Baseline, type Evidence, type FiledIssue, type Landing } from "./lib.ts";

const SCHEDULE_DIR = import.meta.dirname;
const REPO_ROOT = path.resolve(SCHEDULE_DIR, "..", "..");
const CADENCE_DAYS = 7;

function refuse(message: string): never {
  process.stderr.write(`smoke-review: ${message}\n`);
  process.exit(2);
}

async function git(args: string[]): Promise<string> {
  const result = await execa("git", args, { cwd: REPO_ROOT, reject: false });
  if (result.exitCode !== 0) refuse(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

/** Every line of the shared log, or refusal — a review with no data to review. */
async function readLog(): Promise<string[]> {
  const common = await git(["rev-parse", "--git-common-dir"]);
  const logPath = smokeLogPath(common.startsWith("/") ? common : path.join(REPO_ROOT, common));
  return fs.readFile(logPath, "utf8").then(
    (text) => text.split("\n"),
    (e: NodeJS.ErrnoException) => {
      // No log yet is a legitimate state — the tier has simply never run here.
      // It is not a broken watch, so it is not a refusal.
      if (e.code === "ENOENT") return [];
      return refuse(`cannot read ${logPath}: ${e.message}`);
    },
  );
}

/** Lines whose run falls inside `[start, end)`. */
function within(lines: readonly string[], window: { start: string; end: string }): string[] {
  return lines.filter((line) => {
    const record = parseRunRecord(line);
    return record !== null && record.ts >= window.start && record.ts < window.end;
  });
}

/** The window's red runs, most recent first. */
function failuresIn(lines: readonly string[]): Evidence["failures"] {
  const failures: Evidence["failures"] = [];
  for (const line of lines) {
    const record = parseRunRecord(line);
    if (record === null || record.verdict !== "red") continue;
    failures.push({
      ts: record.ts,
      step: record.failedStep ?? "unknown",
      message: record.failure ?? "",
      commit: record.commit,
    });
  }
  return failures.toReversed();
}

async function landingsSince(start: string): Promise<Landing[]> {
  const output = await git([
    "log", "--first-parent", "main", `--since=${start}`, "--format=%H%x00%s",
  ]);
  return output
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [commit = "", subject = ""] = line.split("\0");
      return { commit, subject };
    });
}

/**
 * Bug issues added in the window, by git rather than by mtime: a checkout is
 * full of files whose mtime is the day it was cloned, and a worktree schedule
 * gets a fresh one whenever its branch is rebuilt.
 */
async function bugsSince(start: string): Promise<FiledIssue[]> {
  const output = await git([
    "log", "--first-parent", "main", `--since=${start}`,
    "--diff-filter=A", "--name-only", "--format=",
    "--", "issues/bugs", "issues/closed/bugs",
  ]);
  const paths = [...new Set(output.split("\n").filter((line) => line.endsWith(".md")))];
  const bugs: FiledIssue[] = [];
  for (const filePath of paths) {
    bugs.push({ path: filePath, title: await titleOf(filePath) });
  }
  return bugs;
}

/**
 * An issue's title, read from the commit that ADDED it.
 *
 * Not from `main`: closing an issue is a `git mv` into `issues/closed/`, so by
 * the time a weekly review runs, most of the week's issues are no longer at the
 * path they were added under. Reading `main:<path>` returned "unreadable" for
 * two thirds of them.
 */
async function titleOf(filePath: string): Promise<string> {
  const addedIn = await git([
    "log", "--first-parent", "main", "--diff-filter=A", "-1", "--format=%H", "--", filePath,
  ]);
  if (addedIn === "") return "(title unreadable — no commit adds this path)";
  const text = await execa("git", ["show", `${addedIn}:${filePath}`], {
    cwd: REPO_ROOT,
    reject: false,
  }).then((r) => (r.exitCode === 0 ? r.stdout : ""));
  const raw = /^title:\s*(.*?)\s*$/m.exec(text)?.[1];
  if (raw === undefined) return "(no title in frontmatter)";
  // YAML-quoted, so a title containing a quote arrives escaped.
  return raw.replace(/^"(.*)"$/s, "$1").replaceAll('\\"', '"');
}

const stateDir = process.env["SCHEDULE_STATE_DIR"];
if (stateDir === undefined || stateDir === "") refuse("SCHEDULE_STATE_DIR is not set");
const baselineFile = path.join(stateDir, "last-review.json");
const dryRun = process.env["SCHEDULE_DRY_RUN"] === "1";

const baseline: Baseline | null = await fs.readFile(baselineFile, "utf8").then(
  (text) => parseBaseline(text),
  (e: NodeJS.ErrnoException) =>
    e.code === "ENOENT" ? null : refuse(`cannot read ${baselineFile}: ${e.message}`),
);

const now = new Date();
const windowEnd = now.toISOString();
const start = windowStart({ baseline, now, cadenceDays: CADENCE_DAYS });

const lines = (await readLog()).filter((line) => line.trim() !== "");
const windowed = within(lines, { start, end: windowEnd });
const evidence: Evidence = {
  windowStart: start,
  windowEnd,
  allTime: summarizeSmokeLog(lines),
  window: summarizeSmokeLog(windowed),
  failures: failuresIn(windowed),
  landings: await landingsSince(start),
  bugs: await bugsSince(start),
};

async function recordBaseline(): Promise<void> {
  // A dry run writes nothing anywhere — including the baseline, which would
  // otherwise move the window and make the next real run review less than it
  // should.
  if (dryRun) {
    console.log(`[smoke-review] dry run: would record the window end (${windowEnd}) as the baseline.`);
    return;
  }
  const next: Baseline = { reviewedAt: windowEnd, runs: evidence.allTime.runs };
  await fs.writeFile(baselineFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

const briefing = formatBriefing(evidence);
console.log(briefing);
await recordBaseline();

if (!hasSomethingToReview(evidence)) {
  // No smoke runs and no bugs filed: nothing happened, so nothing is said.
  process.exit(0);
}

if (dryRun) {
  console.log("[smoke-review] dry run: the handoff below is printed, not recorded.");
}
await execa(
  path.join(REPO_ROOT, "bin", "schedules"),
  [
    "handoff",
    "--title",
    `Smoke tier review: ${String(evidence.window.runs)} run${evidence.window.runs === 1 ? "" : "s"},` +
      ` ${String(evidence.bugs.length)} bug${evidence.bugs.length === 1 ? "" : "s"} filed`,
    "--body",
    "-",
  ],
  { input: briefing, stdout: "inherit", stderr: "inherit" },
);

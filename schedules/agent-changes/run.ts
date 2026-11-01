/**
 * The box agent changelog's curator: what landed on `main` since the last run
 * on surfaces a box agent sees, and which bug and feature issues closed.
 *
 * The baseline moves only after the handoff succeeds, so a failed handoff keeps
 * its range. The first run has no baseline: it records `main` and says so.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";
import { formatBriefing, hasWork, isAgentSurface, issueTitle, type Candidates, type Landing } from "./lib.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const BRANCH = "worktree-agent-changes";
const CLOSED_PATHS = ["issues/closed/bugs", "issues/closed/features"];

function refuse(message: string): never {
  process.stderr.write(`agent-changes: ${message}\n`);
  process.exit(2);
}

async function git(args: string[]): Promise<string> {
  const result = await execa("git", args, { cwd: REPO_ROOT, reject: false });
  if (result.exitCode !== 0) refuse(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

const nonEmpty = (text: string): string[] => text.split("\n").filter((line) => line !== "");

async function landingsSince(previous: string): Promise<Landing[]> {
  const log = nonEmpty(await git(["log", "--first-parent", "--format=%h%x09%as%x09%s", `${previous}..main`]));
  const landings = await Promise.all(log.map(async (line): Promise<Landing> => {
    const [hash = "", date = "", subject = ""] = line.split("\t");
    const files = nonEmpty(await git(["diff", "--name-only", `${hash}^1`, hash])).filter(isAgentSurface);
    return { hash, date, subject, files };
  }));
  return landings.filter((landing) => landing.files.length > 0);
}

async function gather(previous: string): Promise<Candidates> {
  const closed = nonEmpty(await git(["diff", "--name-only", "--diff-filter=AR", `${previous}..main`, "--", ...CLOSED_PATHS]));
  const closedIssues = await Promise.all(closed.map(async (file) => ({
    path: file,
    title: issueTitle({ path: file, source: await git(["show", `main:${file}`]) }),
  })));
  const hasBranch = (await execa("git", ["rev-parse", "--verify", "--quiet", BRANCH], { cwd: REPO_ROOT, reject: false })).exitCode === 0;
  const unlanded = hasBranch ? nonEmpty(await git(["log", "--format=%h %s", `main..${BRANCH}`])) : [];
  return { landings: await landingsSince(previous), closedIssues, unlanded };
}

const stateDir = process.env["SCHEDULE_STATE_DIR"];
if (stateDir === undefined || stateDir === "") refuse("SCHEDULE_STATE_DIR is not set");
const baselineFile = path.join(stateDir, "last-sha");
const dryRun = process.env["SCHEDULE_DRY_RUN"] === "1";
const schedulesCli = path.join(REPO_ROOT, "bin", "schedules");
const head = (await git(["rev-parse", "main"])).trim();

async function recordBaseline(): Promise<void> {
  if (dryRun) {
    console.log(`[agent-changes] dry run: would record ${head} as the baseline.`);
    return;
  }
  await fs.writeFile(baselineFile, `${head}\n`, "utf8");
}

const previous = await fs.readFile(baselineFile, "utf8").then(
  (text) => text.trim(),
  (e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? null : refuse(`cannot read ${baselineFile}: ${e.message}`)),
);

if (previous === null) {
  await recordBaseline();
  await execa(schedulesCli, ["alert", "--priority", "fyi", "--title", "agent-changes baseline recorded", "--message", `First run: main at ${head.slice(0, 9)} is now the baseline. Later runs hand off what lands after it. Nothing was changed.`], { stdout: "inherit", stderr: "inherit" });
  process.exit(0);
}

const candidates = await gather(previous);
if (!hasWork(candidates)) {
  await recordBaseline();
  process.exit(0);
}

if (dryRun) console.log("[agent-changes] dry run: the handoff below is printed, not recorded.");
await execa(schedulesCli, ["handoff", "--title", `Box agent changelog: ${String(candidates.landings.length)} landings, ${String(candidates.closedIssues.length)} closed issues`, "--body", "-"], {
  input: formatBriefing({ ...candidates, previous, head }),
  stdout: "inherit",
  stderr: "inherit",
});
await recordBaseline();

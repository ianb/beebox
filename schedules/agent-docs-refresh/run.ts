/**
 * The weekly agent-docs refresh: what changed on `main` since the last refresh
 * that the public documentation corpus (site/docs/, llms.txt) might need to
 * reflect.
 *
 * The corpus is three kinds of page: authored (site/docs/**), promoted repo
 * docs (site/docs-manifest.yaml), and the generated engine reference. The
 * generated set tracks the engine on its own; the other two drift. So this run
 * keeps the sha of the last refresh in `$SCHEDULE_STATE_DIR/last-sha` and hands
 * off the commits since then that touched anything the corpus describes: the
 * engine, its docs, the manifest's sources, the authored pages themselves, the
 * other apps the corpus covers. The judgment (which page a change bears on,
 * what to rewrite) is the session's; this script only decides whether there is
 * anything to look at.
 *
 * The first run has no baseline, so it records `main`'s sha and says so with
 * an `fyi` alert. The baseline is rewritten on every real run, including runs
 * that hand off, so a commit is news exactly once.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";

const SCHEDULE_DIR = import.meta.dirname;
const REPO_ROOT = path.resolve(SCHEDULE_DIR, "..", "..");

function refuse(message: string): never {
  process.stderr.write(`agent-docs-refresh: ${message}\n`);
  process.exit(2);
}

/** Paths whose change can make a corpus page wrong. Everything else (issues, plans, tooling) cannot. */
const RELEVANT = /^(beebox\/(src|docs|box-docs|docker|deploy\/README\.md|CLAUDE\.md|code-style\.md|frontend\.md)|beebox-clerk\/|ios-app\/|site\/docs\/|site\/docs-manifest\.yaml|README\.md|CONTRIBUTING\.md)/u;

const stateDir = process.env["SCHEDULE_STATE_DIR"];
if (stateDir === undefined || stateDir === "") refuse("SCHEDULE_STATE_DIR is not set");
const baselineFile = path.join(stateDir, "last-sha");
const dryRun = process.env["SCHEDULE_DRY_RUN"] === "1";
const schedulesCli = path.join(REPO_ROOT, "bin", "schedules");

async function git(args: string[]): Promise<string> {
  const result = await execa("git", args, { cwd: REPO_ROOT, reject: false });
  if (result.exitCode !== 0) refuse(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

const head = (await git(["rev-parse", "main"])).trim();

async function recordBaseline(): Promise<void> {
  if (dryRun) {
    console.log(`[agent-docs-refresh] dry run: would record ${head} as the baseline.`);
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
  await execa(
    schedulesCli,
    [
      "alert",
      "--priority",
      "fyi",
      "--title",
      "agent-docs baseline recorded",
      "--message",
      `First run of this schedule: main at ${head.slice(0, 9)} is now the baseline, and later runs hand off the commits since then that bear on the public docs. Nothing was changed.`,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  process.exit(0);
}

// The baseline may predate a history rewrite; a range git cannot resolve is a
// broken watch, not a quiet week.
const log = await git(["log", "--first-parent", "--format=%h%x09%as%x09%s", `${previous}..main`]);
const commits = log === "" ? [] : log.split("\n");
const changed = (await git(["diff", "--name-only", `${previous}..main`])).split("\n").filter((p) => p !== "");
const relevant = changed.filter((p) => RELEVANT.test(p));

await recordBaseline();
if (relevant.length === 0) process.exit(0);

const byArea = new Map<string, number>();
for (const file of relevant) {
  const area = file.split("/").slice(0, 2).join("/");
  byArea.set(area, (byArea.get(area) ?? 0) + 1);
}

const body = [
  `Since the last refresh (${previous.slice(0, 9)}), main has ${String(commits.length)} first-parent commit(s) touching ${String(relevant.length)} file(s) the public docs may describe.`,
  "",
  "Files changed, by area:",
  "",
  ...[...byArea.entries()].toSorted((a, b) => b[1] - a[1]).map(([area, n]) => `- ${area}: ${String(n)}`),
  "",
  "Commits (first-parent, newest first):",
  "",
  "```",
  ...commits,
  "```",
  "",
  `Full file list: \`git diff --name-only ${previous.slice(0, 9)}..${head.slice(0, 9)}\`. The range is the whole week; judge which pages it bears on.`,
  "",
].join("\n");

if (dryRun) console.log("[agent-docs-refresh] dry run: the handoff below is printed, not recorded.");
await execa(
  schedulesCli,
  ["handoff", "--title", `Agent docs refresh: ${String(commits.length)} commits, ${String(relevant.length)} relevant files`, "--body", "-"],
  { input: body, stdout: "inherit", stderr: "inherit" },
);

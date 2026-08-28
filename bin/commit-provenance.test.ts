// Tests for commit-provenance.ts — the Workstream/Plan/Issue commit trailers.
// Pure functions are called directly; the three CLI modes run as a subprocess
// against a throwaway git repo, including one real `git commit -m` with the
// prepare hook installed via core.hooksPath. Run with:
//   node --import tsx --test bin/commit-provenance.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).
//
// bin/CLAUDE.md points new bin/ tests at callback-box/test/dev/*.doctest.md.
// This one stays a .test.ts because it must fork a git repo per case and drive
// hooks end to end; it sits beside the sibling bin/*.test.ts files it matches.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkIssueTrailers,
  filterByTrailer,
  issueBasenames,
  issueFiles,
  miscasedKeys,
  nearestIssues,
  resolvePlan,
  trailerValues,
  workstreamFromBranch,
} from "./commit-provenance.js";

const SCRIPT = fileURLToPath(new URL("commit-provenance.ts", import.meta.url));
// Absolute: node resolves a bare `--import tsx` against the CWD, and every
// subprocess here runs inside a throwaway repo with no node_modules.
const TSX = import.meta.resolve("tsx");
const tmpRoots: string[] = [];

after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
});

function tmpDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `commit-provenance-${label}-`));
  tmpRoots.push(dir);
  return fs.realpathSync(dir);
}

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function plan(workstream: string): string {
  return `---\ntitle: "p"\nstatus: draft\nworkstream: ${workstream}\n---\n\nbody\n`;
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

/** Run the script as the hooks do — a real subprocess, cwd inside the repo. */
function run(cwd: string, args: string[]): Run {
  const result = spawnSync("node", ["--import", TSX, SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_EDITOR: "true" },
  });
}

/** A throwaway repo on `worktree-<stream>` with plan/issue files and the hooks installed. */
function makeRepo(params: { label: string; branch: string; plans: string[]; issues: string[] }): string {
  const { label, branch, plans, issues } = params;
  const dir = tmpDir(label);
  git(dir, ["init", "-b", branch, "-q"]);
  git(dir, ["config", "user.name", "Test"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  for (const [index, stream] of plans.entries()) {
    write(path.join(dir, "callback-box/docs/plans", `plan-${index}.md`), plan(stream));
  }
  for (const rel of issues) write(path.join(dir, "issues", rel), "---\ntitle: i\n---\n");
  if (issues.length > 0) write(path.join(dir, "issues/CLAUDE.md"), "queue conventions, not an issue\n");
  const hooks = path.join(dir, "hooks");
  fs.mkdirSync(hooks);
  fs.writeFileSync(
    path.join(hooks, "prepare-commit-msg"),
    `#!/bin/sh\nexec node --import "${TSX}" "${SCRIPT}" --prepare "$1" "$2"\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(hooks, "commit-msg"),
    `#!/bin/sh\nexec node --import "${TSX}" "${SCRIPT}" --check "$1"\n`,
    { mode: 0o755 },
  );
  git(dir, ["config", "core.hooksPath", hooks]);
  write(path.join(dir, "README.md"), "seed\n");
  git(dir, ["add", "-A"]);
  return dir;
}

function msgFile(dir: string, content: string): string {
  const file = path.join(dir, "MSG");
  fs.writeFileSync(file, content);
  return file;
}

test("workstreamFromBranch strips the worktree- prefix and ignores other branches", () => {
  assert.equal(workstreamFromBranch("worktree-commit-provenance"), "commit-provenance");
  assert.equal(workstreamFromBranch("worktree-a-b-c\n"), "a-b-c");
  assert.equal(workstreamFromBranch("main"), null);
  assert.equal(workstreamFromBranch("HEAD"), null); // detached, mid-rebase
  assert.equal(workstreamFromBranch("worktree-"), null);
});

test("resolvePlan returns the single claiming plan, and null for zero or several", () => {
  const dir = tmpDir("plans");
  assert.equal(resolvePlan(path.join(dir, "missing"), "x"), null);
  fs.mkdirSync(path.join(dir, "plans"));
  const plans = path.join(dir, "plans");
  assert.equal(resolvePlan(plans, "x"), null);
  write(path.join(plans, "one.md"), plan("x"));
  write(path.join(plans, "other.md"), plan("y"));
  write(path.join(plans, "notes.txt"), plan("x")); // non-.md is ignored
  assert.equal(resolvePlan(plans, "x"), "one");
  assert.equal(resolvePlan(plans, "y"), "other");
  assert.equal(resolvePlan(plans, "z"), null);
  write(path.join(plans, "two.md"), plan("x"));
  assert.equal(resolvePlan(plans, "x"), null); // ambiguous — omitted, not guessed
});

test("trailerValues matches the canonical key exactly; miscasedKeys catches the rest", () => {
  const parsed = "Workstream: s\nIssue: a\nissue: b\nCo-Authored-By: X <x@y>\n";
  assert.deepEqual(trailerValues(parsed, "Issue"), ["a"]); // `issue:` is not the key the queries grep for
  assert.deepEqual(trailerValues(parsed, "Plan"), []);
  assert.deepEqual(miscasedKeys(parsed), ["issue"]);
  assert.deepEqual(miscasedKeys("Workstream: s\nPLAN: p\nCo-Authored-By: X <x@y>\n"), ["PLAN"]);
  assert.deepEqual(miscasedKeys("Workstream: s\nIssue: a\nPlan: p\n"), []);
});

test("issueBasenames takes only category-dir issues — the queue's own prose is not citable", () => {
  const dir = tmpDir("issues");
  write(path.join(dir, "issues/bugs/2026-01-01-a.md"), "x");
  write(path.join(dir, "issues/closed/features/2026-01-02-b.md"), "x");
  write(path.join(dir, "issues/CLAUDE.md"), "x"); // conventions doc, not an issue
  write(path.join(dir, "issues/closed/README.md"), "x");
  assert.deepEqual(issueBasenames(path.join(dir, "issues")).toSorted(), [
    "2026-01-01-a",
    "2026-01-02-b",
  ]);
  assert.deepEqual(issueBasenames(path.join(dir, "nope")), []);
});

test("issueFiles maps a basename to where the issue lives NOW", () => {
  // The basename is an issue's identity repo-wide, and closing one is a
  // `git mv` — so a lookup by name has to answer with the current directory,
  // which is also how a reader learns the issue is closed.
  const dir = tmpDir("issues-now");
  write(path.join(dir, "issues/bugs/2026-01-01-a.md"), "x");
  write(path.join(dir, "issues/closed/features/2026-01-02-b.md"), "x");
  write(path.join(dir, "issues/CLAUDE.md"), "x");
  const files = issueFiles(path.join(dir, "issues"));
  assert.equal(files.get("2026-01-01-a"), path.join("bugs", "2026-01-01-a.md"));
  assert.equal(files.get("2026-01-02-b"), path.join("closed", "features", "2026-01-02-b.md"));
  assert.equal(files.has("CLAUDE"), false);
});

test("filterByTrailer keeps only commits whose parsed trailers hold the value", () => {
  const records = "abc123 fix: real\u0000x\u001Fy\ndef456 fix: prose only\u0000\n789abc fix: two\u0000 x \n";
  assert.deepEqual(filterByTrailer(records, "x"), ["abc123 fix: real", "789abc fix: two"]);
  assert.deepEqual(filterByTrailer("", "x"), []);
});

test("nearestIssues suggests at most three by shared prefix, best first", () => {
  const known = ["2026-08-24-alpha", "2026-08-24-alphabet", "2026-08-24-beta", "2026-08-01-gamma", "other"];
  assert.deepEqual(nearestIssues(known, "2026-08-24-alphax"), [
    "2026-08-24-alpha",
    "2026-08-24-alphabet",
    "2026-08-24-beta",
  ]);
  assert.deepEqual(nearestIssues(known, "zzz"), []);
});

test("checkIssueTrailers accepts open and closed names, flags misses with the bare form", () => {
  const dir = tmpDir("check");
  write(path.join(dir, "issues/bugs/2026-08-24-real.md"), "x");
  write(path.join(dir, "issues/closed/bugs/2026-08-20-done.md"), "x");
  const issues = path.join(dir, "issues");
  assert.deepEqual(checkIssueTrailers("Issue: 2026-08-24-real\n", issues), []);
  assert.deepEqual(checkIssueTrailers("Issue: 2026-08-20-done\n", issues), []);
  assert.deepEqual(checkIssueTrailers("", issues), []);
  const missing = checkIssueTrailers("Issue: 2026-08-24-reall\n", issues);
  assert.equal(missing.length, 1);
  assert.deepEqual({ ...missing[0]!, suggestions: missing[0]!.suggestions[0] },
    { value: "2026-08-24-reall", bare: null, bareExists: false, suggestions: "2026-08-24-real" });
  const pathForm = checkIssueTrailers("Issue: issues/bugs/2026-08-24-real.md\n", issues);
  assert.equal(pathForm.length, 1);
  assert.deepEqual({ ...pathForm[0]!, suggestions: pathForm[0]!.suggestions[0] },
    { value: "issues/bugs/2026-08-24-real.md", bare: "2026-08-24-real", bareExists: true, suggestions: "2026-08-24-real" });
});

test("--prepare stamps Workstream + Plan, is idempotent, and keeps trailers above # comments", () => {
  const dir = makeRepo({ label: "prepare", branch: "worktree-alpha", plans: ["alpha"], issues: [] });
  const file = msgFile(dir, "feat: thing\n\nbody\n\n# Please enter the commit message.\n# On branch worktree-alpha\n");
  assert.equal(run(dir, ["--prepare", file, "message"]).status, 0);
  const stamped = fs.readFileSync(file, "utf8");
  assert.match(stamped, /\nWorkstream: alpha\nPlan: plan-0\n/);
  assert.ok(stamped.indexOf("Workstream: alpha") < stamped.indexOf("# Please enter"), stamped);
  run(dir, ["--prepare", file, "message"]);
  const again = fs.readFileSync(file, "utf8");
  assert.equal(again.match(/^Workstream: /gm)?.length, 1, again);
  assert.equal(again.match(/^Plan: /gm)?.length, 1, again);
});

test("--prepare omits Plan when no single plan claims the stream, and no-ops off a worktree branch", () => {
  const two = makeRepo({ label: "ambiguous", branch: "worktree-alpha", plans: ["alpha", "alpha"], issues: [] });
  const twoFile = msgFile(two, "chore: x\n");
  run(two, ["--prepare", twoFile, "message"]);
  assert.equal(fs.readFileSync(twoFile, "utf8"), "chore: x\n\nWorkstream: alpha\n");

  const onMain = makeRepo({ label: "main", branch: "main", plans: ["alpha"], issues: [] });
  const mainFile = msgFile(onMain, "chore: x\n");
  run(onMain, ["--prepare", mainFile, "message"]);
  assert.equal(fs.readFileSync(mainFile, "utf8"), "chore: x\n");
});

test("--prepare skips a squash message", () => {
  const dir = makeRepo({ label: "squash", branch: "worktree-alpha", plans: ["alpha"], issues: [] });
  const file = msgFile(dir, "squashed\n");
  run(dir, ["--prepare", file, "squash"]);
  assert.equal(fs.readFileSync(file, "utf8"), "squashed\n");
});

test("a real `git commit -m` on a worktree branch carries the trailers (hook end to end)", () => {
  const dir = makeRepo({ label: "e2e", branch: "worktree-alpha", plans: ["alpha"], issues: ["bugs/2026-08-24-real.md"] });
  git(dir, ["commit", "-q", "-m", "feat: end to end"]);
  assert.equal(git(dir, ["log", "-1", "--format=%(trailers)"]).trim(), "Workstream: alpha\nPlan: plan-0");
  assert.match(git(dir, ["log", "-1", "--format=%s"]), /^feat: end to end$/m);

  // Amend re-runs the hook; --if-exists replace keeps one trailer per key.
  git(dir, ["commit", "-q", "--amend", "-m", "feat: end to end (reworded)"]);
  assert.equal(git(dir, ["log", "-1", "--format=%(trailers)"]).trim(), "Workstream: alpha\nPlan: plan-0");
});

test("--cleanup=scissors keeps the trailers above the scissors line, junk stripped", () => {
  const dir = makeRepo({ label: "scissors", branch: "worktree-alpha", plans: ["alpha"], issues: [] });
  const file = path.join(dir, "SCISSORS_MSG");
  fs.writeFileSync(
    file,
    "feat: scissors\n\n# ------------------------ >8 ------------------------\n"
      + "# Do not modify or remove the line above.\ndiff --git a/x b/x\njunk below the scissors\n",
  );
  // scissors truncation only happens when the message is edited (GIT_EDITOR=true
  // is a no-op editor), so -e is part of what makes this the real case.
  git(dir, ["commit", "-q", "--cleanup=scissors", "-e", "-F", file]);
  assert.equal(git(dir, ["log", "-1", "--format=%(trailers)"]).trim(), "Workstream: alpha\nPlan: plan-0");
  const body = git(dir, ["log", "-1", "--format=%B"]);
  assert.doesNotMatch(body, /junk below the scissors/);
  assert.doesNotMatch(body, />8/);
});

test("--check blocks an unknown Issue: name and passes a known one, through the commit-msg hook", () => {
  const dir = makeRepo({
    label: "issuecheck",
    branch: "worktree-alpha",
    plans: ["alpha"],
    issues: ["bugs/2026-08-24-real.md", "closed/bugs/2026-08-20-done.md"],
  });
  const ok = run(dir, ["--check", msgFile(dir, "fix: x\n\nIssue: 2026-08-24-real\n")]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(run(dir, ["--check", msgFile(dir, "fix: x\n\nIssue: 2026-08-20-done\n")]).status, 0);
  assert.equal(run(dir, ["--check", msgFile(dir, "fix: x\n")]).status, 0);

  // "Issue:" as body prose is not a trailer — interpret-trailers ignores it.
  assert.equal(run(dir, ["--check", msgFile(dir, "fix: x\n\nIssue: unclear whether this helps\n\nWorkstream: alpha\n")]).status, 0);

  const bad = run(dir, ["--check", msgFile(dir, "fix: x\n\nIssue: 2026-08-24-reall\n")]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Issue: 2026-08-24-reall/);
  assert.match(bad.stderr, /did you mean: 2026-08-24-real/);

  const pathForm = run(dir, ["--check", msgFile(dir, "fix: x\n\nIssue: issues/bugs/2026-08-24-real.md\n")]);
  assert.equal(pathForm.status, 1);
  assert.match(pathForm.stderr, /use the bare name, no path and no \.md: Issue: 2026-08-24-real$/m);

  // issues/CLAUDE.md is the queue's conventions doc, not a citable issue.
  const notAnIssue = run(dir, ["--check", msgFile(dir, "fix: x\n\nIssue: CLAUDE\n")]);
  assert.equal(notAnIssue.status, 1);
  assert.match(notAnIssue.stderr, /Issue: CLAUDE/);

  // The queries grep the canonical spelling, so a mis-cased key is an error.
  const miscased = run(dir, ["--check", msgFile(dir, "fix: x\n\nissue: 2026-08-24-real\n")]);
  assert.equal(miscased.status, 1);
  assert.match(miscased.stderr, /use `Issue:`/);
  const miscasedPlan = run(dir, ["--check", msgFile(dir, "fix: x\n\nPLAN: p\n")]);
  assert.equal(miscasedPlan.status, 1);
  assert.match(miscasedPlan.stderr, /use `Plan:`/);

  // And the same check refuses the commit for real.
  fs.writeFileSync(path.join(dir, "README.md"), "changed\n");
  git(dir, ["add", "README.md"]);
  assert.throws(() => git(dir, ["commit", "-q", "-m", "fix: y\n\nIssue: 2026-08-24-nope\n"]), /nope|failed/);
});

test("query modes list matching commits, --all by default and main with --main", () => {
  const dir = makeRepo({ label: "query", branch: "main", plans: [], issues: ["bugs/2026-08-24-real.md"] });
  git(dir, ["commit", "-q", "-m", "chore: base"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", "fix: on main\n\nWorkstream: alpha\nIssue: 2026-08-24-real\n"]);
  git(dir, ["checkout", "-q", "-b", "worktree-alpha"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", "feat: unlanded\n\nWorkstream: alpha\nPlan: plan-0\n"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", "docs: prose only\n\nIssue: 2026-08-24-real is what this is about, but no trailer.\n\nSigned-off-by: T <t@e>\n"]);
  git(dir, ["checkout", "-q", "main"]);

  const all = run(dir, ["--workstream", "alpha"]).stdout;
  assert.match(all, /fix: on main/);
  assert.match(all, /feat: unlanded/);
  const onMain = run(dir, ["--workstream", "alpha", "--main"]).stdout;
  assert.match(onMain, /fix: on main/);
  assert.doesNotMatch(onMain, /feat: unlanded/);
  assert.match(run(dir, ["--plan", "plan-0"]).stdout, /feat: unlanded/);
  const byIssue = run(dir, ["--issue", "2026-08-24-real"]).stdout;
  assert.match(byIssue, /fix: on main/);
  assert.doesNotMatch(byIssue, /prose only/); // body prose is not a trailer
  assert.equal(run(dir, ["--workstream", "nobody"]).stdout, "");
  assert.equal(run(dir, ["--issue", "2026-08-24-rea"]).stdout, ""); // anchored, not a prefix match
});

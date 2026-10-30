// # bin/lib/git.ts
//
// `bin/` scripts read git output through one primitive whose failure mode is
// stated at each call. Output keeps leading spaces (porcelain columns) and
// loses one trailing newline. See `bin/lib/git.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, gitBranch, gitCommonDir, gitOrNull, gitTopLevel } from "../../lib/git.js";

function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "bin-git-")));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  return dir;
}

void test("Porcelain output keeps its leading space; one trailing newline goes", async (t) => {
  const repo = makeRepo();
  t.teardown(() => rmSync(repo, { recursive: true, force: true }));
  writeFileSync(join(repo, "a.txt"), "x");
  execFileSync("git", ["add", "a.txt"], { cwd: repo });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "a"], { cwd: repo });
  writeFileSync(join(repo, "a.txt"), "y");
  t.check(git(["status", "--porcelain"], { cwd: repo, onError: "throw" }), " M a.txt");
  t.check({ top: gitTopLevel(repo), common: gitCommonDir(repo) }, { top: repo, common: join(repo, ".git") });
});

void test("A failing command throws, returns null, or returns empty, as asked", async (t) => {
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "bin-git-outside-")));
  t.teardown(() => rmSync(outside, { recursive: true, force: true }));
  const args = ["--git-dir", join(outside, "missing"), "rev-parse", "HEAD"];
  t.check(gitOrNull(args, { cwd: outside }), null);
  t.check(git(args, { cwd: outside, onError: "empty" }), "");
  // A missing working directory fails before git runs, so the throwing case
  // prints no git error into the test output.
  let threw = false;
  try {
    git(["status"], { cwd: join(outside, "gone"), onError: "throw" });
  } catch (_e) {
    threw = true;
  }
  t.check(threw, true);
});

void test("gitBranch names the checked-out branch", async (t) => {
  const repo = makeRepo();
  t.teardown(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "a"], { cwd: repo });
  t.check(gitBranch(repo), "main");
});

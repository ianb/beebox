// # finish-preflight: when typecheck and lint may be skipped
//
// Pre-commit typechecks and lints every worktree commit, so `finish-preflight`
// skips both when nothing arrived that pre-commit never saw. A merge is such an
// arrival: git runs no pre-commit hook on a clean merge.

import * as tapModule from "tap";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = path.resolve(process.cwd(), "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "finish-preflight-"));

const git = (...args: string[]): string =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GIT_MERGE_AUTOEDIT: "no" },
  }).trim();
const write = (file: string, content: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};
const commit = (file: string, content: string): void => {
  write(file, content);
  git("add", file);
  git("commit", "-qm", `edit ${file}`);
};

const preflight = (): {
  merge: { status: string };
  skipTypecheckLint: { value: boolean; reason: string };
  verification: { command: string; skip?: string }[];
} =>
  JSON.parse(
    execFileSync(process.execPath, ["--import", import.meta.resolve("tsx"), path.join(repo, "bin/finish-preflight.ts"), "--json"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GIT_MERGE_AUTOEDIT: "no" },
    }),
  );
/** The sheet's verdict on `pnpm typecheck`: "runs", or the skip reason. */
const typecheck = (sheet: ReturnType<typeof preflight>): string =>
  sheet.verification.find((c) => c.command === "pnpm typecheck")?.skip ?? "runs";

tapModule.default.teardown(async () => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (error) {
    console.error("teardown failed:", error);
    process.exitCode = 1;
  }
});

// The fixture repo has no workspace packages, so a `bin/` change is verified by
// the root scripts, and `pnpm typecheck` is the command to watch.
void test("The fixture repo has no workspace packages, so a bin/ change is verified by t...", async (t) => {
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  write("pnpm-workspace.yaml", "packages: []\n");
  write("package.json", JSON.stringify({ scripts: { test: "true", typecheck: "true" } }));
  git("add", ".");
  commit("bin/tool.ts", "export const a = 1;\n");
  git("checkout", "-qb", "worktree-demo");
  commit("bin/tool.ts", "export const a = 2;\n");

  // ## A rerun after a code-bringing merge still verifies
  //
  // Main gains code after the branch forked. The first preflight run merges it in.
  // That merged tree has never been typechecked, so the first run must not skip.

  git("checkout", "-q", "main");
  commit("bin/other.ts", "export const b = 1;\n");
  git("checkout", "-q", "worktree-demo");
  const first = preflight();
  t.check([first.merge.status, first.skipTypecheckLint.value, typecheck(first)], [
    "merged",
    false,
    "runs",
  ]);

  // A finish that stops after the first run (a failing test, a human question)
  // runs preflight again. This run's merge is a no-op, but the tree is the same
  // unchecked tree. Three finishes in October 2026 skipped typecheck here because
  // the rule asked only about the current merge.

  const second = preflight();
  t.check([second.merge.status, second.skipTypecheckLint.value, typecheck(second)], [
    "up-to-date",
    false,
    "runs",
  ]);

  // The reason names the earlier merge, so a reader can find the commit.

  const mergeSha = git("log", "--merges", "-1", "--format=%H").slice(0, 9);
  assert.ok(second.skipTypecheckLint.reason.includes(`merge ${mergeSha}`));

  // ## A merge that brought only docs keeps the skip
  //
  // Docs reach no typecheck or lint, so a branch whose only merge brought
  // Markdown skips both, on the first run and on every rerun.

  git("checkout", "-q", "-b", "worktree-docs", "main");
  commit("bin/docs-branch.ts", "export const c = 1;\n");
  git("checkout", "-q", "main");
  commit("notes/readme.md", "# notes\n");
  git("checkout", "-q", "worktree-docs");
  const docsFirst = preflight();
  const docsSecond = preflight();
  t.check([docsFirst.skipTypecheckLint.value, docsSecond.skipTypecheckLint.value, typecheck(docsSecond)], [
    true,
    true,
    "no merge on this branch brought code; pre-commit covered every commit",
  ]);

  // ## A docs-only branch skips after main brings code
  //
  // When the branch changes only Markdown, the merged tree's code is main's
  // code, so the merge of main's code does not force the checks.

  git("checkout", "-q", "-b", "worktree-notes", "main");
  commit("notes/plan.md", "# plan\n");
  git("checkout", "-q", "main");
  commit("bin/main-code.ts", "export const d = 1;\n");
  git("checkout", "-q", "worktree-notes");
  const notes = preflight();
  t.check([notes.merge.status, notes.skipTypecheckLint.value, notes.skipTypecheckLint.reason.includes("only in .md files")], [
    "merged",
    true,
    true,
  ]);

  // A merge commit that edits code (a conflict resolution, or here an evil
  // merge amended by hand) leaves HEAD's code unlike main's, so the checks run
  // even though every non-merge branch commit was docs-only.

  git("checkout", "-q", "-b", "worktree-resolve", "main");
  commit("notes/resolve.md", "# resolve\n");
  git("checkout", "-q", "main");
  commit("bin/main-code.ts", "export const d = 2;\n");
  git("checkout", "-q", "worktree-resolve");
  git("merge", "-q", "--no-ff", "main");
  write("bin/main-code.ts", "export const d = 3;\n");
  git("commit", "-q", "--amend", "-a", "--no-edit");
  const resolved = preflight();
  t.check([resolved.skipTypecheckLint.value, typecheck(resolved)], [false, "runs"]);
  assert.ok(resolved.skipTypecheckLint.reason.includes("bin/main-code.ts"));

  // ## Arguments
  //
  // `--help` prints the usage. It must not merge main: main gains a commit here,
  // and the branch head must stay where it was. An unknown flag exits 2 for the
  // same reason.

  git("checkout", "-q", "main");
  commit("notes/later.md", "# later\n");
  git("checkout", "-q", "worktree-docs");
  const before = git("rev-parse", "HEAD");
  const cli = (arg: string) =>
    spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), path.join(repo, "bin/finish-preflight.ts"), arg], {
      cwd: root,
      encoding: "utf8",
    });
  const help = cli("--help");
  const unknown = cli("--jsno");
  t.check([help.status, help.stdout.split("\n")[0], unknown.status, git("rev-list", "--count", `${before}..HEAD`)], [
    0,
    "usage: bin/finish-preflight [--json] [--no-merge]",
    2,
    "0",
  ]);
});

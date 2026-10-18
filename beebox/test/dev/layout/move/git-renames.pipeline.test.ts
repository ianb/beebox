// # `--mentions-from-git`: mapping composed from git rename detection, then mention rewrite
//
// Same fixture style as `apply.pipeline.test.ts` and
// `mention-rewrite.pipeline.test.ts`, but the moves come from
// `computeRenamesFromGit` (git's own rename detection between two commits)
// instead of a hand-written move list — the mode `layout-move
// --mentions-from-git <base>` uses for files that moved before the move tool's
// mention-rewrite existed.

import { test } from "tap";
import "agent-doctest/tap";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { computeRenamesFromGit } from "../../../../src/dev/layout/move/git-renames.js";
import { computeMentionRewrite } from "../../../../src/dev/layout/move/mention-rewrite.js";
import { scanRoots } from "../../../../src/dev/layout/move/roots.js";

const execFileAsync = promisify(execFile);
const repoRoot = await mkdtemp(join(tmpdir(), "layout-move-git-renames-"));
async function write(rel: string, content: string) {
  const full = join(repoRoot, rel);
  await mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
  await writeFile(full, content);
}
async function read(rel: string): Promise<string> {
  return readFile(join(repoRoot, rel), "utf8");
}
async function git(args: string[]) {
  await execFileAsync("git", args, { cwd: repoRoot });
}
await git(["init", "-q"]);
await git(["config", "user.email", "test@example.com"]);
await git(["config", "user.name", "Test"]);

await write("pkg/package.json", JSON.stringify({ name: "pkg" }));
await write("pkg/src/a.ts", "export const a = 1;\n");
// A doc mentioning the file's original path, to be rewritten once the
// composed mapping is known.
await write("docs/note.md", "See pkg/src/a.ts for details.\n");
await git(["add", "-A"]);
await git(["commit", "-q", "-m", "base"]);
const base = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot })).stdout.trim();

// ## A file moved twice across two commits composes into one old->new mapping
void test("A file moved twice across two commits composes into one old->new mapping", async (t) => {
  // doctest:L50
  await mkdir(join(repoRoot, "pkg/src/sub"), { recursive: true });
  await git(["mv", "pkg/src/a.ts", "pkg/src/sub/a.ts"]);
  await git(["commit", "-q", "-m", "first move"]);
  await git(["mv", "pkg/src/sub/a.ts", "pkg/src/sub/renamed.ts"]);
  await git(["commit", "-q", "-m", "second move"]);

  // doctest:L56
  const { moves, rejected } = computeRenamesFromGit({ repoRoot, base });
  t.check(moves, [
    {
      from: "pkg/src/a.ts",
      to: "pkg/src/sub/renamed.ts",
    },
  ]);

  // doctest:L60
  t.check(rejected, []);

  // ## The composed mapping rewrites the doc's mention

  // doctest:L67
  const roots = scanRoots(repoRoot);
  const result = computeMentionRewrite({ repoRoot, moves, roots, rewrittenFiles: new Set() });
  await t.checkText(result.fileEdits.get("docs/note.md"), "See pkg/src/sub/renamed.ts for details.");

  // doctest:L72
  await t.checkText(await read("docs/note.md"), "See pkg/src/a.ts for details.");
});

// ## A detected rename is rejected when the working tree contradicts it: new path missing
//
// A detected rename is only trusted once the working tree agrees with it, not
// just git's history — so a rename whose new path was since deleted (without a
// commit) is rejected rather than blindly applied.
void test("A detected rename is only trusted once the working tree agrees with it, not j...", async (t) => {
  // doctest:L83
  await write("pkg/src/gone.ts", "export const gone = 1;\n");
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "add gone.ts"]);
  const goneBase = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot })).stdout.trim();
  await git(["mv", "pkg/src/gone.ts", "pkg/src/moved-gone.ts"]);
  await git(["commit", "-q", "-m", "move gone.ts"]);
  await rm(join(repoRoot, "pkg/src/moved-gone.ts"));

  // doctest:L91
  const { moves: goneMoves, rejected: goneRejected } = computeRenamesFromGit({ repoRoot, base: goneBase });
  await t.checkText(goneMoves.some((m) => m.from === "pkg/src/gone.ts"), "false");

  // doctest:L95
  t.check(goneRejected.find((r) => r.from === "pkg/src/gone.ts")?.reason, "new path does not exist in the working tree");
});

// ## Rejected when the working tree contradicts it: old path still present
void test("Rejected when the working tree contradicts it: old path still present", async (t) => {
  t.teardown(async () => {
    try {
      t.teardown(() => rm(repoRoot, { recursive: true, force: true }));
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L102
  await write("pkg/src/still.ts", "export const still = 1;\n");
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "add still.ts"]);
  const stillBase = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot })).stdout.trim();
  await git(["mv", "pkg/src/still.ts", "pkg/src/moved-still.ts"]);
  await git(["commit", "-q", "-m", "move still.ts"]);
  await write("pkg/src/still.ts", "export const still = 1;\n");

  // doctest:L110
  const { moves: stillMoves, rejected: stillRejected } = computeRenamesFromGit({ repoRoot, base: stillBase });
  await t.checkText(stillMoves.some((m) => m.from === "pkg/src/still.ts"), "false");

  // doctest:L114
  t.check(stillRejected.find((r) => r.from === "pkg/src/still.ts")?.reason, "old path still exists in the working tree");
});

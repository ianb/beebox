// bin/staged-snapshot.ts: the pre-commit hook's checks read a snapshot of the
// commit index. The pure rules (directory name, where a node_modules entry
// points, the lock decision) are tested directly; `sync` and `finish` run as
// the hook runs them, in a throwaway repository with another agent's unstaged
// edits on disk. Run with: node --import tsx --test bin/staged-snapshot.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { linkTarget, lockStep, snapshotDirName } from "./staged-snapshot.js";

const SCRIPT = join(import.meta.dirname, "staged-snapshot.ts");

test("the directory name keeps the basename and separates checkouts that share it", () => {
  const a = snapshotDirName("/work/one/beebox");
  const b = snapshotDirName("/work/two/beebox");
  assert.match(a, /^beebox-[\da-f]{8}$/);
  assert.notEqual(a, b);
});

test("a workspace link points into the snapshot; installed packages point at the checkout", () => {
  const ctx = { toplevel: "/work/repo", snapTop: "/cache/snap/tree" };
  // beebox/node_modules/@ianbicking/tap-check -> ../../../tap-check
  assert.equal(
    linkTarget({ realEntry: "/work/repo/beebox/node_modules/@ianbicking/tap-check", resolved: "/work/repo/tap-check", ...ctx }),
    "/cache/snap/tree/tap-check",
  );
  // A link into another node_modules (pnpm's store, a hoisted package) is an installed package.
  const store = "/work/repo/node_modules/.pnpm/x@1/node_modules/x";
  assert.equal(linkTarget({ realEntry: "/work/repo/beebox/node_modules/x", resolved: store, ...ctx }), "/work/repo/beebox/node_modules/x");
  // Outside the checkout, or not a link at all.
  assert.equal(linkTarget({ realEntry: "/work/repo/node_modules/y", resolved: "/opt/y", ...ctx }), "/work/repo/node_modules/y");
  assert.equal(linkTarget({ realEntry: "/work/repo/node_modules/z", resolved: null, ...ctx }), "/work/repo/node_modules/z");
  // The checkout root itself is not a workspace package path.
  assert.equal(linkTarget({ realEntry: "/work/repo/node_modules/w", resolved: "/work/repo", ...ctx }), "/work/repo/node_modules/w");
});

test("a lock held by a live hook is waited on; a dead or unreadable owner is taken over", () => {
  assert.equal(lockStep({ owner: 42, ownerAlive: true, self: 7 }), "wait");
  assert.equal(lockStep({ owner: 42, ownerAlive: false, self: 7 }), "take-over");
  assert.equal(lockStep({ owner: null, ownerAlive: false, self: 7 }), "take-over");
  assert.equal(lockStep({ owner: 7, ownerAlive: true, self: 7 }), "acquired");
});

// The test may itself run under a hook; git must see only the fixture repo.
function cleanEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const name of ["GIT_INDEX_FILE", "GIT_DIR", "GIT_WORK_TREE"]) {
    if (!(name in extra)) delete env[name];
  }
  return env;
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: cleanEnv({}) });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

// `--import tsx` resolves from the cwd, which is the fixture repo; give it this checkout's tsx.
const TSX = import.meta.resolve("tsx");

function snapshotCli(params: { repo: string; state: string }, args: string[]): Run {
  const result = spawnSync(process.execPath, ["--import", TSX, SCRIPT, ...args], {
    cwd: params.repo,
    env: cleanEnv({ BBX_STATE_DIR: params.state }),
    encoding: "utf8",
  });
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

/** A repository with one commit, a staged change, and another agent's unstaged work on disk. */
function fixture(): { repo: string; state: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "staged-snapshot-")));
  const repo = join(root, "repo");
  const state = join(root, "state");
  mkdirSync(join(repo, "pkg"), { recursive: true });
  mkdirSync(join(repo, "lib"), { recursive: true });
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "t");
  writeFileSync(join(repo, ".gitignore"), "node_modules/\ndist/\n");
  writeFileSync(join(repo, "package.json"), "{}\n");
  writeFileSync(join(repo, "pkg/package.json"), "{}\n");
  writeFileSync(join(repo, "lib/package.json"), "{}\n");
  writeFileSync(join(repo, "staged.ts"), "export const a = 1;\n");
  writeFileSync(join(repo, "deleted-on-disk.ts"), "export const b = 1;\n");
  writeFileSync(join(repo, "edited-on-disk.ts"), "export const c = 1;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  // Installed packages: an external one at the root, a workspace link in pkg/.
  mkdirSync(join(repo, "node_modules/external"), { recursive: true });
  mkdirSync(join(repo, "pkg/node_modules/@scope"), { recursive: true });
  symlinkSync("../../../lib", join(repo, "pkg/node_modules/@scope/lib"));
  // The staged change, then another agent's unstaged work.
  writeFileSync(join(repo, "staged.ts"), "export const a = 2;\n");
  git(repo, "add", "staged.ts");
  unlinkSync(join(repo, "deleted-on-disk.ts"));
  writeFileSync(join(repo, "edited-on-disk.ts"), "export const c: number = ;\n");
  writeFileSync(join(repo, "untracked.md"), "# new\n");
  return { repo, state };
}

function sync(repo: string, state: string): { tree: string; index: string; captured: string } {
  const run = snapshotCli({ repo, state }, ["sync", "--owner", String(process.pid)]);
  assert.equal(run.status, 0, run.stderr);
  const [tree = "", index = "", captured = ""] = run.stdout.trim().split("\t");
  return { tree, index, captured };
}

function finish(params: { repo: string; state: string; captured: string }): Run {
  const commitIndex = join(params.repo, ".git/index");
  return snapshotCli(params, [
    "finish", "--owner", String(process.pid), "--tree", params.captured, "--index", commitIndex, "--status", "0",
  ]);
}

test("the snapshot holds the commit index's files, whatever is on disk", () => {
  const { repo, state } = fixture();
  try {
    const snap = sync(repo, state);
    assert.equal(readFileSync(join(snap.tree, "staged.ts"), "utf8"), "export const a = 2;\n");
    assert.equal(readFileSync(join(snap.tree, "deleted-on-disk.ts"), "utf8"), "export const b = 1;\n");
    assert.equal(readFileSync(join(snap.tree, "edited-on-disk.ts"), "utf8"), "export const c = 1;\n");
    assert.equal(existsSync(join(snap.tree, "untracked.md")), false);
    assert.equal(readFileSync(join(snap.tree, ".git"), "utf8"), `gitdir: ${join(repo, ".git")}\n`);
    assert.equal(readlinkSync(join(snap.tree, "node_modules/external")), join(repo, "node_modules/external"));
    assert.equal(readlinkSync(join(snap.tree, "pkg/node_modules/@scope/lib")), join(snap.tree, "lib"));
    assert.equal(finish({ repo, state, captured: snap.captured }).status, 0);
  } finally {
    rmSync(join(repo, ".."), { recursive: true, force: true });
  }
});

test("a resync undoes what a check left behind: edits, new files, build output", () => {
  const { repo, state } = fixture();
  try {
    const first = sync(repo, state);
    assert.equal(finish({ repo, state, captured: first.captured }).status, 0);
    writeFileSync(join(first.tree, "staged.ts"), "edited by a check\n");
    writeFileSync(join(first.tree, "stray.ts"), "created by a check\n");
    mkdirSync(join(first.tree, "dist"));
    writeFileSync(join(first.tree, "dist/old.d.ts"), "stale\n");
    const second = sync(repo, state);
    assert.equal(readFileSync(join(second.tree, "staged.ts"), "utf8"), "export const a = 2;\n");
    assert.equal(existsSync(join(second.tree, "stray.ts")), false);
    assert.equal(existsSync(join(second.tree, "dist")), false);
    assert.equal(readlinkSync(join(second.tree, "pkg/node_modules/@scope/lib")), join(second.tree, "lib"));
    assert.equal(finish({ repo, state, captured: second.captured }).status, 0);
  } finally {
    rmSync(join(repo, ".."), { recursive: true, force: true });
  }
});

test("finish fails when the commit index or the snapshot changed during the checks", () => {
  const { repo, state } = fixture();
  try {
    // Another agent stages a file while the checks run.
    let snap = sync(repo, state);
    writeFileSync(join(repo, "late.ts"), "export const late = 1;\n");
    git(repo, "add", "late.ts");
    const late = finish({ repo, state, captured: snap.captured });
    assert.equal(late.status, 1);
    assert.match(late.stderr, /commit index changed/);

    // A check stages content into the snapshot's own index.
    snap = sync(repo, state);
    writeFileSync(join(snap.tree, "staged.ts"), "rewritten\n");
    assert.equal(spawnSync("git", ["add", "staged.ts"], { cwd: snap.tree, env: cleanEnv({ GIT_INDEX_FILE: snap.index }) }).status, 0);
    const staged = finish({ repo, state, captured: snap.captured });
    assert.equal(staged.status, 1);
    assert.match(staged.stderr, /changed the snapshot's index/);

    // A check edits a tracked file and leaves it.
    snap = sync(repo, state);
    writeFileSync(join(snap.tree, "staged.ts"), "rewritten\n");
    const edited = finish({ repo, state, captured: snap.captured });
    assert.equal(edited.status, 1);
    assert.match(edited.stderr, /changed tracked files/);
  } finally {
    rmSync(join(repo, ".."), { recursive: true, force: true });
  }
});

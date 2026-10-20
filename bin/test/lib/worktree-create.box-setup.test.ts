// # Worktree creation commits a fresh box clone's setup
//
// Creating a worktree clones the test box, points its `beebox` dependency at
// the worktree's engine, installs, and runs `bbx engine init`. Those changes are
// committed in the clone, so it starts clean: knowledge audits refuse a dirty
// box, and their reset after each test returns to this commit with the engine
// link intact (issues/closed/bugs/2026-10-09-knowledge-audit-refuses-fresh-worktree-box-clone.md).
// A reused clone is never committed: it may hold the developer's own edits.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(process.cwd(), "..");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

async function writeExecutable(file: string, body: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
  await fs.chmod(file, 0o755);
}

void test("a fresh clone's setup changes are committed; a reused clone's edits are not", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "worktree-create-box-setup-"));
  t.teardown(() => fs.rm(root, { recursive: true, force: true }));
  const mono = path.join(root, "mono");
  const boxSrc = path.join(root, "box-src");
  const binDir = path.join(root, "test-bin");

  // A monorepo whose `beebox/bin/bbx` stands in for `bbx engine init`: it
  // rewrites the box's `.claude/settings.json`, as the real one stamps hook paths.
  await fs.mkdir(path.join(mono, "bin/lib"), { recursive: true });
  for (const file of ["comments-store.sh", "exhibits-store.sh", "session-registry.sh", "worktree-create.sh", "worktree-git-lock.sh", "worktree-paths.sh"]) {
    await fs.copyFile(path.join(repoRoot, "bin/lib", file), path.join(mono, "bin/lib", file));
  }
  await writeExecutable(path.join(mono, "beebox/bin/bbx"), '#!/bin/sh\nprintf \'{"hooks":"worktree"}\\n\' > "$3/.claude/settings.json"\n');
  git(root, "init", "-q", "-b", "main", mono);
  git(mono, "-c", "user.email=t@example.com", "-c", "user.name=T", "add", ".");
  git(mono, "-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-qm", "fixture");

  // A package-layout source box that depends on beebox.
  await fs.mkdir(path.join(boxSrc, ".claude"), { recursive: true });
  await fs.writeFile(path.join(boxSrc, "package.json"), '{"dependencies":{"beebox":"^1.0.0"}}\n');
  await fs.writeFile(path.join(boxSrc, ".claude/settings.json"), '{"hooks":"source"}\n');
  git(root, "init", "-q", "-b", "main", boxSrc);
  git(boxSrc, "-c", "user.email=t@example.com", "-c", "user.name=T", "add", ".");
  git(boxSrc, "-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-qm", "box");

  // `pnpm install` in the box writes a lockfile; elsewhere it does nothing.
  await writeExecutable(path.join(binDir, "pnpm"), '#!/bin/sh\ncase "$PWD" in *box-worktrees*) echo "lockfileVersion: 9" > pnpm-lock.yaml ;; esac\n');

  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    BBX_WORKTREE_ROOT: path.join(root, "worktrees"),
    BBX_BOX_ROOT: path.join(root, "box-worktrees"),
    BBX_BOX_SRC: boxSrc,
    BBX_EXHIBITS_ROOT: path.join(root, "exhibits"),
    BBX_COMMENTS_ROOT: path.join(root, "comments"),
    BBX_STATE_DIR: path.join(root, "state"),
    GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com",
  };
  const create = (): number | null => spawnSync("bash", ["-c", 'set -euo pipefail; . "$1"; wt_create wt main', "create-test", path.join(mono, "bin/lib/worktree-create.sh")], { env, encoding: "utf-8" }).status;

  t.check(create(), 0);
  const clone = path.join(root, "box-worktrees/wt/test1");
  const commits = git(clone, "log", "--format=%s");
  const committed = git(clone, "show", "--name-only", "--format=", "HEAD");
  t.check({ status: git(clone, "status", "--porcelain"), commits, committed }, {
    status: "",
    commits: "Worktree setup: link the beebox engine to worktree wt\nbox",
    committed: ".claude/settings.json\npackage.json\npnpm-lock.yaml",
  });

  // Creating again reuses the clone and leaves a developer's edit uncommitted:

  await fs.writeFile(path.join(clone, "notes.md"), "my edit\n");
  t.check(create(), 0);
  t.check({ status: git(clone, "status", "--porcelain"), head: git(clone, "log", "-1", "--format=%s") }, {
    status: "?? notes.md",
    head: "Worktree setup: link the beebox engine to worktree wt",
  });
});

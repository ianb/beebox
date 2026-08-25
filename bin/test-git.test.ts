// Tests for the working-state hash the ledger records. A `.test.ts` rather
// than a doctest for the same reason bin/test-graph.test.ts is one: this is
// part of the machinery that decides which doctests run, so testing it from
// inside that suite is circular.
//
//   node --import tsx --test bin/test-git.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { treeHash } from "./test-git.js";

function repo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "test-git-"));
  const run = (args: string[]): void => {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  };
  run(["init", "-b", "main"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  writeFileSync(join(dir, "tracked.ts"), "export const a = 1;\n");
  run(["add", "-A"]);
  run(["commit", "-m", "first"]);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("two working states differing only in a dirty file's CONTENT hash differently", () => {
  // The bug this fixes: hashing the porcelain TEXT names the dirty files and
  // says nothing about what is in them, so fail -> edit that same file -> pass
  // kept one hash and deriveFlakes called a real fix a flake.
  const fx = repo();
  try {
    writeFileSync(join(fx.dir, "tracked.ts"), "export const a = 2;\n");
    const broken = treeHash(fx.dir);
    writeFileSync(join(fx.dir, "tracked.ts"), "export const a = 3;\n");
    const fixed = treeHash(fx.dir);
    assert.notEqual(broken, fixed);

    // And the same content twice is the same hash — which is what makes
    // "failed then passed with nothing changed" mean anything.
    writeFileSync(join(fx.dir, "tracked.ts"), "export const a = 2;\n");
    assert.equal(treeHash(fx.dir), broken);
  } finally {
    fx.cleanup();
  }
});

test("an untracked file's content counts, and an ignored one does not", () => {
  const fx = repo();
  try {
    writeFileSync(join(fx.dir, ".gitignore"), "ignored/\n");
    execFileSync("git", ["add", "-A"], { cwd: fx.dir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "ignore"], { cwd: fx.dir, stdio: "ignore" });

    mkdirSync(join(fx.dir, "new"), { recursive: true });
    writeFileSync(join(fx.dir, "new/file.ts"), "export const b = 1;\n");
    const before = treeHash(fx.dir);
    writeFileSync(join(fx.dir, "new/file.ts"), "export const b = 2;\n");
    assert.notEqual(treeHash(fx.dir), before);

    mkdirSync(join(fx.dir, "ignored"), { recursive: true });
    const withoutIgnored = treeHash(fx.dir);
    writeFileSync(join(fx.dir, "ignored/junk.ts"), "export const c = 1;\n");
    assert.equal(treeHash(fx.dir), withoutIgnored);
  } finally {
    fx.cleanup();
  }
});

test("a staged change is part of the working state", () => {
  const fx = repo();
  try {
    const clean = treeHash(fx.dir);
    writeFileSync(join(fx.dir, "tracked.ts"), "export const a = 9;\n");
    execFileSync("git", ["add", "-A"], { cwd: fx.dir, stdio: "ignore" });
    assert.notEqual(treeHash(fx.dir), clean);
  } finally {
    fx.cleanup();
  }
});

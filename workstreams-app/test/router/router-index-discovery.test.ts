// Unit test for router-pages.ts's disk/handle merge. No server spawn — the
// merge is a pure function over a disk listing and the router's handle map.
// Run with:
//   node --import tsx --test workstreams-app/test/router/router-index-discovery.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDiscovered } from "../../src/router/router-pages.js";
import type { WorktreeHandle } from "../../src/router/router-lifecycle.js";
import { pruneOrphanHubConfigs } from "../../src/router/router-real-effects.js";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

// A real handle in the phase a culled worktree ends up in: nothing is left to
// start, so its last attempt failed.
function failedHandle(name: string): WorktreeHandle {
  return {
    name,
    startedAt: 0,
    lifecycle: {
      phase: "failed",
      lastError: { message: "gone", phase: "spawn", viteOutput: "", fastifyOutput: "", at: 0 },
    },
  };
}

test("main is always present and sorts first", () => {
  const rows = mergeDiscovered({ diskNames: ["zebra", "alpha"], coreEntries: [], scanned: true });
  assert.deepEqual(rows.map((r) => r.name), ["main", "alpha", "zebra"]);
});

test("a handle whose checkout was culled is dropped", () => {
  // The regression: the router keeps a handle after `bin/workstreams sweep`
  // removes the worktree, so the index listed workstreams that no longer exist
  // and could only ever render as `failed`.
  const rows = mergeDiscovered({ diskNames: ["live-one"], coreEntries: [["culled", failedHandle("culled")]], scanned: true });
  assert.deepEqual(rows.map((r) => r.name), ["main", "live-one"]);
});

test("a handle for a checkout still on disk is kept and carries its state", () => {
  const rows = mergeDiscovered({ diskNames: ["live-one"], coreEntries: [["live-one", failedHandle("live-one")]], scanned: true });
  const row = rows.find((r) => r.name === "live-one");
  assert.ok(row?.handle, "the handle must survive so the index can show its state");
});

test("when the disk scan fails, every handle is shown rather than an empty router", () => {
  const rows = mergeDiscovered({ diskNames: [], coreEntries: [["only-in-memory", failedHandle("only-in-memory")]], scanned: false });
  assert.deepEqual(rows.map((r) => r.name), ["main", "only-in-memory"]);
});

// --- hub-config pruning ---------------------------------------------------

test("pruneOrphanHubConfigs removes configs with no checkout, and spares main", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hub-config-prune-"));
  try {
    const configDir = path.join(dir, "hub-configs");
    const worktreesRoot = path.join(dir, "worktrees");
    await fs.mkdir(configDir, { recursive: true });
    await fs.mkdir(path.join(worktreesRoot, "live-one"), { recursive: true });
    for (const name of ["live-one", "culled", "main"]) {
      await fs.writeFile(path.join(configDir, `${name}.json`), "{}");
    }
    await fs.writeFile(path.join(configDir, "notes.txt"), "not a config");

    const pruned = await pruneOrphanHubConfigs({ configDir, worktreesRoot });

    assert.deepEqual(pruned, ["culled"]);
    // main has no directory under the worktrees root, so a name-based existence
    // check would delete its config on every boot. notes.txt survives because
    // only .json entries are considered.
    assert.deepEqual((await fs.readdir(configDir)).toSorted(), ["live-one.json", "main.json", "notes.txt"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a missing config dir prunes nothing rather than throwing", async () => {
  assert.deepEqual(await pruneOrphanHubConfigs({ configDir: "/nonexistent/hub-configs", worktreesRoot: "/nonexistent/worktrees" }), []);
});

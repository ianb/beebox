// # Persisted state migration
//
// The first `bbx` invocation moves a box's old hidden state directory to
// `.beebox` with one same-filesystem rename. It never merges two directories.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { migrateBoxState, migrationLockPath, PersistedStateConflictError } from "../../src/lib/state-migration.js";
import { acquireLock, releaseLock } from "../../src/lib/file-lock.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bbx-state-migration-"));
async function migrationConflict(): Promise<boolean> {
  try {
    await migrateBoxState(root);
    return false;
  } catch (error) {
    return error instanceof PersistedStateConflictError;
  }
}

// ## Old-only state moves and repeated migration is a no-op
void test("Old-only state moves and repeated migration is a no-op", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L27
  fs.mkdirSync(path.join(root, ".callback-box"));
  fs.writeFileSync(path.join(root, ".callback-box", "state.json"), "old\n");
  print(await migrateBoxState(root));
  print(fs.readFileSync(path.join(root, ".beebox", "state.json"), "utf-8").trim());
  await t.checkText(out.with(print(await migrateBoxState(root))), `migrated
old
unchanged`);
});

// ## Both paths fail closed
void test("Both paths fail closed", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L40
  fs.mkdirSync(path.join(root, ".callback-box"));
  await t.checkText(out.with(print(await migrationConflict())), "true");
});

// ## An empty canonical directory is not a second generation
//
// Something creating `.beebox/` ahead of the migration (a booting hub child, a
// `mkdir -p`) used to leave the box refusing every command until a person
// deleted the empty directory. Empty means nothing to merge.
void test("Something creating .beebox/ ahead of the migration (a booting hub child, a mk...", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L52
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bbx-empty-new-migration-"));
  fs.mkdirSync(path.join(emptyRoot, ".callback-box"));
  fs.writeFileSync(path.join(emptyRoot, ".callback-box", "state.json"), "old\n");
  fs.mkdirSync(path.join(emptyRoot, ".beebox"));
  print(await migrateBoxState(emptyRoot));
  print(fs.readFileSync(path.join(emptyRoot, ".beebox", "state.json"), "utf-8").trim());
  print(fs.existsSync(path.join(emptyRoot, ".callback-box")));
  await t.checkText(out.with(fs.rmSync(emptyRoot, { recursive: true, force: true })), `migrated
old
false`);
});

// ## The legacy box marker joins the canonical state directory
void test("The legacy box marker joins the canonical state directory", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L68
  const markerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bbx-marker-migration-"));
  fs.writeFileSync(path.join(markerRoot, ".cb-box"), '{"shapeVersion":2}\n');
  print(await migrateBoxState(markerRoot));
  print(fs.existsSync(path.join(markerRoot, ".cb-box")));
  print(fs.readFileSync(path.join(markerRoot, ".beebox", "box.json"), "utf-8").trim());
  await t.checkText(out.with(fs.rmSync(markerRoot, { recursive: true, force: true })), `migrated
false
{"shapeVersion":2}`);
});

// ## Concurrent callers serialize and converge
void test("Concurrent callers serialize and converge", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L82
  const concurrentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bbx-concurrent-migration-"));
  fs.mkdirSync(path.join(concurrentRoot, ".callback-box"));
  fs.writeFileSync(path.join(concurrentRoot, ".callback-box", "state.json"), "old\n");
  const results = await Promise.all([migrateBoxState(concurrentRoot), migrateBoxState(concurrentRoot)]);
  print(results.toSorted().join(","));
  print(`${fs.existsSync(path.join(concurrentRoot, ".callback-box"))}:${fs.existsSync(path.join(concurrentRoot, ".beebox"))}`);
  await t.checkText(out.with(fs.rmSync(concurrentRoot, { recursive: true, force: true })), `migrated,unchanged
false:true`);
});

// ## A box with no legacy state answers without the lock
//
// Every `getBoxShape` call runs the migration check, so it sits on most request
// paths. Concurrent requests that each took the lock queued behind its 100 ms
// retry poll: four parallel secret lookups took 300 ms. With no legacy path
// present the check needs no lock, so it answers even while another holder has
// the lock.
void test("Every getBoxShape call runs the migration check, so it sits on most request p...", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L102
  const migratedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bbx-migrated-no-lock-"));
  fs.mkdirSync(path.join(migratedRoot, ".beebox"));
  await acquireLock(migrationLockPath(migratedRoot), { purpose: "test holder" });
  const started = Date.now();
  print(await migrateBoxState(migratedRoot));
  print(Date.now() - started < 100);
  await releaseLock(migrationLockPath(migratedRoot));
  await t.checkText(out.with(fs.rmSync(migratedRoot, { recursive: true, force: true })), `unchanged
true`);
});

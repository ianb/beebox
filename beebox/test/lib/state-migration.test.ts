// # Persisted state migration
//
// The first `bbx` invocation moves a box's old hidden state directory to
// `.beebox` with one same-filesystem rename. It never merges two directories.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, instanceOf } from "@ianbicking/tap-check/check";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { migrateBoxState, migrationLockPath, PersistedStateConflictError } from "../../src/lib/state-migration.js";
import { acquireLock, releaseLock } from "../../src/lib/file-lock.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bbx-state-migration-"));

// ## Old-only state moves and repeated migration is a no-op
void test("Old-only state moves and repeated migration is a no-op", async (t) => {
  // doctest:L27
  fs.mkdirSync(path.join(root, ".callback-box"));
  fs.writeFileSync(path.join(root, ".callback-box", "state.json"), "old\n");
  t.check(await migrateBoxState(root), "migrated");
  t.check(fs.readFileSync(path.join(root, ".beebox", "state.json"), "utf-8"), "old\n");
  t.check(await migrateBoxState(root), "unchanged");
});

// ## Both paths fail closed
void test("Both paths fail closed", async (t) => {
  // doctest:L40
  fs.mkdirSync(path.join(root, ".callback-box"));
  await t.checkThrows(() => migrateBoxState(root), "PersistedStateConflictError");
  t.check(await migrateBoxState(root).catch((e: unknown) => e), instanceOf(PersistedStateConflictError));
});

// ## An empty canonical directory is not a second generation
//
// Something creating `.beebox/` ahead of the migration (a booting hub child, a
// `mkdir -p`) used to leave the box refusing every command until a person
// deleted the empty directory. Empty means nothing to merge.
void test("Something creating .beebox/ ahead of the migration (a booting hub child, a mk...", async (t) => {
  // doctest:L52
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bbx-empty-new-migration-"));
  fs.mkdirSync(path.join(emptyRoot, ".callback-box"));
  fs.writeFileSync(path.join(emptyRoot, ".callback-box", "state.json"), "old\n");
  fs.mkdirSync(path.join(emptyRoot, ".beebox"));
  t.check(await migrateBoxState(emptyRoot), "migrated");
  t.check(fs.readFileSync(path.join(emptyRoot, ".beebox", "state.json"), "utf-8"), "old\n");
  t.check(fs.existsSync(path.join(emptyRoot, ".callback-box")), false);
  fs.rmSync(emptyRoot, { recursive: true, force: true });
});

// ## The legacy box marker joins the canonical state directory
void test("The legacy box marker joins the canonical state directory", async (t) => {
  // doctest:L68
  const markerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bbx-marker-migration-"));
  fs.writeFileSync(path.join(markerRoot, ".cb-box"), '{"shapeVersion":2}\n');
  t.check(await migrateBoxState(markerRoot), "migrated");
  t.check(fs.existsSync(path.join(markerRoot, ".cb-box")), false);
  t.check(fs.readFileSync(path.join(markerRoot, ".beebox", "box.json"), "utf-8"), '{"shapeVersion":2}\n');
  fs.rmSync(markerRoot, { recursive: true, force: true });
});

// ## Concurrent callers serialize and converge
void test("Concurrent callers serialize and converge", async (t) => {
  // doctest:L82
  const concurrentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bbx-concurrent-migration-"));
  fs.mkdirSync(path.join(concurrentRoot, ".callback-box"));
  fs.writeFileSync(path.join(concurrentRoot, ".callback-box", "state.json"), "old\n");
  const results = await Promise.all([migrateBoxState(concurrentRoot), migrateBoxState(concurrentRoot)]);
  t.check(results.toSorted(), ["migrated", "unchanged"]);
  t.check(
    { legacy: fs.existsSync(path.join(concurrentRoot, ".callback-box")), canonical: fs.existsSync(path.join(concurrentRoot, ".beebox")) },
    { legacy: false, canonical: true },
  );
  fs.rmSync(concurrentRoot, { recursive: true, force: true });
});

// ## A box with no legacy state answers without the lock
//
// Every `getBoxShape` call runs the migration check, so it sits on most request
// paths. Concurrent requests that each took the lock queued behind its 100 ms
// retry poll: four parallel secret lookups took 300 ms. With no legacy path
// present the check needs no lock, so it answers even while another holder has
// the lock.
void test("Every getBoxShape call runs the migration check, so it sits on most request p...", async (t) => {
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
  t.check(await migrateBoxState(migratedRoot), "unchanged");
  t.check(Date.now() - started, any(Number).between(0, 99));
  await releaseLock(migrationLockPath(migratedRoot));
  fs.rmSync(migratedRoot, { recursive: true, force: true });
});

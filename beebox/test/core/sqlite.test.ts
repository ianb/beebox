// # The SQLite wrapper
//
// `core/sqlite.ts` is the one place beebox opens SQLite
// (docs/plans/node-sqlite.md). It carries over better-sqlite3's behavior the
// event bus and usage accounting relied on: a 5 s busy timeout, WAL on
// writable opens, synchronous transactions, numeric write results, and
// `.all()` refusing a statement that returns no rows. Rows are validated by a
// zod schema instead of cast.
import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { openSqlite } from "../../src/core/sqlite.js";

function tmpDbPath(t: Test): string {
  const dir = mkdtempSync(join(tmpdir(), "bbx-sqlite-"));
  t.teardown(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "t.db");
}

const valueRow = z.object({ v: z.number() });

test("a writable open sets the busy timeout and WAL", async (t) => {
  const db = openSqlite(tmpDbPath(t));
  t.teardown(() => db.close());
  t.check(db.prepare("PRAGMA busy_timeout").get(z.object({ timeout: z.number() })), { timeout: 5000 });
  t.check(db.prepare("PRAGMA journal_mode").get(z.object({ journal_mode: z.string() })), { journal_mode: "wal" });
});

test("a read-only open refuses a missing file and refuses writes", async (t) => {
  const dbPath = tmpDbPath(t);
  await t.checkThrows(() => openSqlite(dbPath, { readOnly: true }), "Error: unable to open database file");
  const writer = openSqlite(dbPath);
  writer.exec("CREATE TABLE t (v INTEGER)");
  writer.close();
  const reader = openSqlite(dbPath, { readOnly: true });
  t.teardown(() => reader.close());
  await t.checkThrows(() => reader.exec("INSERT INTO t VALUES (1)"), "Error: attempt to write a readonly database");
});

test("run returns numbers; get and all validate rows", async (t) => {
  const db = openSqlite(tmpDbPath(t));
  t.teardown(() => db.close());
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)");
  t.check(db.prepare("INSERT INTO t (v) VALUES (?)").run(7), { changes: 1, lastInsertRowid: 1 });
  t.check(db.prepare("SELECT v FROM t WHERE id = ?").get(valueRow, 1), { v: 7 });
  t.check(db.prepare("SELECT v FROM t WHERE id = ?").get(valueRow, 2), undefined);
  t.check(db.prepare("SELECT v FROM t").all(valueRow), [{ v: 7 }]);
  // A column the schema does not expect to be text fails loudly instead of reading as a number.
  await t.checkThrows(() => db.prepare("SELECT 'x' AS v").get(valueRow), "ZodError");
});

test("allUnchecked returns rows, and refuses a statement with no columns before running it", async (t) => {
  const db = openSqlite(tmpDbPath(t));
  t.teardown(() => db.close());
  db.exec("CREATE TABLE t (v INTEGER); INSERT INTO t VALUES (1)");
  t.check(db.prepare("SELECT v FROM t").allUnchecked(), [{ v: 1 }]);
  await t.checkThrows(() => db.prepare("DELETE FROM t").allUnchecked(), "SqliteNoRowsStatementError: This statement does not return data");
  t.check(db.prepare("SELECT v FROM t").all(valueRow), [{ v: 1 }]);
});

test("transaction commits on return and rolls back on throw", async (t) => {
  const db = openSqlite(tmpDbPath(t));
  t.teardown(() => db.close());
  db.exec("CREATE TABLE t (v INTEGER)");
  t.check(db.transaction(() => db.prepare("INSERT INTO t VALUES (1)").run().changes), 1);
  await t.checkThrows(() => db.transaction(() => {
    db.prepare("INSERT INTO t VALUES (2)").run();
    throw new RangeError("stop");
  }), "RangeError: stop");
  t.check(db.prepare("SELECT v FROM t").all(valueRow), [{ v: 1 }]);
});

// reconcileSchemaGeneration relies on this: two processes opening a stale
// events.db must not both read the old generation before either writes.
test("an immediate transaction holds the write lock from its start; a deferred one does not", async (t) => {
  const dbPath = tmpDbPath(t);
  const db = openSqlite(dbPath);
  t.teardown(() => db.close());
  db.exec("CREATE TABLE t (v INTEGER)");
  const other = new DatabaseSync(dbPath, { timeout: 0 });
  t.teardown(() => other.close());
  const otherTriesToWrite = (): string => {
    try {
      other.exec("BEGIN IMMEDIATE");
      other.exec("ROLLBACK");
      return "got the lock";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  t.check(db.transaction(() => {
    db.prepare("SELECT v FROM t").all(valueRow);
    return otherTriesToWrite();
  }), "got the lock");
  t.check(db.transaction(() => {
    db.prepare("SELECT v FROM t").all(valueRow);
    return otherTriesToWrite();
  }, { immediate: true }), "database is locked");
});

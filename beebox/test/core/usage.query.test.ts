// # bbx usage --sql is read-only
//
// `queryUsage` runs SQL the caller writes (`bbx usage --sql`). It may read;
// it must not change the usage database. A write fails, and a statement that
// returns no rows (ATTACH, PRAGMA assignments) is refused before it runs, as
// better-sqlite3's `.all()` refused it before the move to node:sqlite
// (docs/plans/node-sqlite.md).
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { queryUsage } from "../../src/core/usage.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

test("queryUsage reads, refuses writes, and refuses statements without rows", async (t) => {
  const box = await makeTmpBox();
  t.check(queryUsage(box.root, "SELECT COUNT(*) AS n FROM usage"), [{ n: 0 }]);
  await t.checkThrows(() => queryUsage(box.root, "DELETE FROM usage"), "SqliteNoRowsStatementError: This statement does not return data");
  await t.checkThrows(() => queryUsage(box.root, "ATTACH DATABASE ':memory:' AS aux"), "SqliteNoRowsStatementError: This statement does not return data");
  // A write that does return rows still fails: the connection is query_only.
  await t.checkThrows(
    () => queryUsage(box.root, "INSERT INTO sync_state (session_id, file_size) VALUES ('x', 1) RETURNING session_id"),
    "Error: attempt to write a readonly database",
  );
  t.check(queryUsage(box.root, "SELECT COUNT(*) AS n FROM sync_state"), [{ n: 0 }]);
});

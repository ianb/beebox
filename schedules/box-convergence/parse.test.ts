import assert from "node:assert/strict";
import test from "node:test";

import { parseProdRows } from "./prod-rows.js";

const TAB = "\t";

test("a converged fleet reports nothing", () => {
  const stdout = ["seminar", "studio", "ledger"].map((n) => `${n}${TAB}0${TAB}`).join("\n");
  assert.deepEqual(parseProdRows(stdout), []);
});

test("the up-to-date marker is not a migration name", () => {
  // `bbx migrate --status` prints `(none — manifest is up to date)` under the
  // Pending heading; the sed that lifts names cannot tell it from one.
  assert.deepEqual(parseProdRows(`ledger${TAB}0${TAB}(none — manifest is up to date),`), []);
});

test("a behind box is reported, with dirt distinguished", () => {
  // The real case, from 2026-09-14: one box three days behind while the deploy
  // sweep skipped it for a dirty tree on every attempt.
  const stdout = [
    `ledger${TAB}4${TAB}remaining-interface-cards,`,
    `studio${TAB}0${TAB}landmark-symbol,schedule-runs-bbx-2026-09,`,
  ].join("\n");
  assert.deepEqual(parseProdRows(stdout), [
    { box: "ledger", pending: ["remaining-interface-cards"], dirty: true, where: "prod" },
    { box: "studio", pending: ["landmark-symbol", "schedule-runs-bbx-2026-09"], dirty: false, where: "prod" },
  ]);
});

test("a blank or malformed line never becomes a box", () => {
  assert.deepEqual(parseProdRows(`\n${TAB}${TAB}\nledger\n`), []);
});

// # The activity log
//
// `.beebox/activity.jsonl` records every action a person took in a view or
// figure, one JSON line each. The writer stamps `seq`, `at` and `user`, keeps
// a line under 4000 bytes, and rotates the file; the reader reads the rotated
// file, then the live one. `seq` keeps increasing across a rotation.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
import * as fs from "node:fs";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { consoleLines } from "../../helpers/console-lines.js";
import {
  activityLogPath,
  lastActivitySeq,
  readActivity,
  recordActivity,
  rotatedActivityLogPath,
} from "../../../src/core/activity/log.js";

function lineBytes(path: string): number[] {
  return fs.readFileSync(path, "utf-8").split("\n").filter((l) => l !== "").map((l) => Buffer.byteLength(l) + 1);
}

// ## A batch is stamped and appended in order
void test("A batch is stamped and appended in order.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const accepted = await recordActivity(box.root, {
    user: "juni@example.com",
    entries: [
      { card: "Lab.figure.card", via: "Unit.view.card", kind: "explored", detail: "add C", activity: { molecules: ["C"] }, chat: "s1" },
      { card: "Lab.figure.card", kind: "explored", detail: "add H", pendingChat: "p1" },
    ],
  });
  t.check(accepted, 2);
  t.check(await readActivity(box.root), [
    { seq: 1, at: isoDate(), user: "juni@example.com", card: "Lab.figure.card", via: "Unit.view.card", kind: "explored", detail: "add C", activity: { molecules: ["C"] }, chat: "s1" },
    { seq: 2, at: isoDate(), user: "juni@example.com", card: "Lab.figure.card", kind: "explored", detail: "add H", pendingChat: "p1" },
  ]);
});

// ## A bad entry is dropped, the rest of the batch is kept
void test("A bad entry is dropped, the rest of the batch is kept.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const warnings = consoleLines(t, "warn");
  const accepted = await recordActivity(box.root, {
    user: null,
    entries: [{ card: "A.view.card", kind: "scrolled", detail: "Intro" }, { card: "", kind: "scrolled" }, { card: "B.view.card", kind: "dancing" }, "junk", { card: "C.view.card", kind: "modified" }],
  });
  t.check(accepted, 2);
  t.check((await readActivity(box.root)).map((l) => `${String(l.seq)} ${l.card}`), ["1 A.view.card", "2 C.view.card"]);
  t.check(warnings(), [
    "[activity] dropped entry 1: Too small: expected string to have >=1 characters",
    "[activity] dropped entry 2: Invalid option: expected one of \"scrolled\"|\"navigated\"|\"explored\"|\"modified\"",
    "[activity] dropped entry 3: Invalid input: expected object, received string",
  ]);
});

// ## A long line is shortened: detail first, then activity
void test("A long line is shortened: detail first, then activity.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await recordActivity(box.root, {
    user: null,
    entries: [
      { card: "A.figure.card", kind: "explored", detail: "d".repeat(900) },
      { card: "A.figure.card", kind: "explored", detail: "short", activity: { blob: "x".repeat(5000) } },
      { card: "A.figure.card", kind: "explored", detail: "ok", activity: { n: 1 } },
    ],
  });
  const lines = await readActivity(box.root);
  t.check(lines.map((l) => ({ seq: l.seq, detail: l.detail?.length, activity: l.activity, truncated: l.truncated })), [
    { seq: 1, detail: 500, activity: undefined, truncated: true },
    { seq: 2, detail: 5, activity: undefined, truncated: true },
    { seq: 3, detail: 2, activity: { n: 1 }, truncated: undefined },
  ]);
  t.check(lineBytes(activityLogPath(box.root)).map((n) => n < 4000), [true, true, true]);
});

// ## Rotation keeps the sequence going and the reader reads both files
void test("Rotation keeps the sequence going and the reader reads both files.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await recordActivity(box.root, { user: null, entries: [{ card: "A.view.card", kind: "navigated" }, { card: "A.view.card", kind: "navigated" }] });
  // An old first line makes the live file due for rotation.
  const old = fs.readFileSync(activityLogPath(box.root), "utf-8").replace(/"at":"[^"]+"/, "\"at\":\"2020-01-01T00:00:00.000Z\"");
  fs.writeFileSync(activityLogPath(box.root), old);
  await recordActivity(box.root, { user: null, entries: [{ card: "B.view.card", kind: "navigated" }] });

  t.check(fs.readFileSync(rotatedActivityLogPath(box.root), "utf-8").match(/"seq":\d+/g), ["\"seq\":1", "\"seq\":2"]);
  t.check((await readActivity(box.root)).map((l) => `${String(l.seq)} ${l.card}`), ["1 A.view.card", "2 A.view.card", "3 B.view.card"]);

  // With the live file gone, the next number still comes from the rotated one.
  fs.rmSync(activityLogPath(box.root));
  t.check(await lastActivitySeq(box.root), 2);
  await recordActivity(box.root, { user: null, entries: [{ card: "C.view.card", kind: "navigated" }] });
  t.check((await readActivity(box.root)).map((l) => l.seq), [1, 2, 3]);
});

// ## Concurrent batches get distinct, ordered sequence numbers
void test("Concurrent batches get distinct, ordered sequence numbers.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await Promise.all(Array.from({ length: 8 }, (_, i) =>
    recordActivity(box.root, { user: null, entries: [{ card: `Card${String(i)}.view.card`, kind: "scrolled", detail: "h" }, { card: `Card${String(i)}.view.card`, kind: "scrolled", detail: "h2" }] })));
  const seqs = (await readActivity(box.root)).map((l) => l.seq);
  t.check(seqs, Array.from({ length: 16 }, (_, i) => i + 1));
});

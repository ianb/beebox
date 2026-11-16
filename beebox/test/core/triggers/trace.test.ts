// # The trigger trace log
//
// One line per evaluation, appended with one write and read from both the
// live and the rotated file. A line that would not fit one atomic append
// loses its oldest records first and says so, so a chatty trigger cannot
// break the log or hide its own result.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fsp from "node:fs/promises";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { appendTrace, readTrace, rotateIfNeeded, serializeTraceLine, traceLogPath, type TraceLine } from "../../../src/core/triggers/trace.js";

const line = (over: Partial<TraceLine>): TraceLine => ({
  at: "2026-11-14T10:00:00.000Z",
  session: "s1",
  activation: "a1",
  label: "Water check",
  reason: "activity",
  entries: 3,
  records: [{ kind: "log", at: "2026-11-14T10:00:00.100Z", message: "looking" }, { kind: "none", at: "2026-11-14T10:00:00.200Z" }],
  outcome: "none",
  ms: 212,
  ...over,
});

// ## Append and read, filtered by session and time
void test("Trace lines are read back oldest first, by session and since a time.", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await appendTrace(box.root, line({}));
  await appendTrace(box.root, line({ at: "2026-11-14T10:05:00.000Z", session: "s2", outcome: "fired", records: [{ kind: "result", at: "2026-11-14T10:05:00.000Z", text: "That's water." }] }));
  await appendTrace(box.root, line({ at: "2026-11-14T10:10:00.000Z", outcome: "error", error: "boom", records: [] }));
  t.check((await readTrace(box.root)).map((l) => [l.at, l.session, l.outcome]), [
    ["2026-11-14T10:00:00.000Z", "s1", "none"],
    ["2026-11-14T10:05:00.000Z", "s2", "fired"],
    ["2026-11-14T10:10:00.000Z", "s1", "error"],
  ]);
  t.check((await readTrace(box.root, { session: "s1", since: new Date("2026-11-14T10:10:00.000Z") })).map((l) => l.error), ["boom"]);

  // Rotation keeps the old lines readable.
  t.check(await rotateIfNeeded(box.root, { now: new Date("2026-11-14T11:00:00.000Z") }), false);
  t.check(await rotateIfNeeded(box.root, { now: new Date("2026-12-20T11:00:00.000Z") }), true);
  await appendTrace(box.root, line({ at: "2026-12-20T11:00:00.000Z", session: "s3" }));
  t.check((await readTrace(box.root)).map((l) => l.session), ["s1", "s2", "s1", "s3"]);
  // A corrupt line is skipped, not fatal.
  await fsp.appendFile(traceLogPath(box.root), "{not json\n");
  t.check((await readTrace(box.root)).map((l) => l.session), ["s1", "s2", "s1", "s3"]);
});

// ## Oversized lines lose their oldest records first
void test("A line over the cap drops its oldest records and marks itself truncated.", (t) => {
  const big = "x".repeat(2000);
  const records: TraceLine["records"] = [
    { kind: "log", at: "t1", message: big },
    { kind: "log", at: "t2", message: big },
    { kind: "judge", at: "t3", questions: ["water"], verdict: { water: { type: "noul", probability: 0.9 } }, ms: 300 },
    { kind: "result", at: "t4", text: "That's water." },
  ];
  const parsed: unknown = JSON.parse(serializeTraceLine(line({ records })));
  t.check(parsed, {
    at: "2026-11-14T10:00:00.000Z",
    session: "s1",
    activation: "a1",
    label: "Water check",
    reason: "activity",
    entries: 3,
    records: [
      { kind: "log", at: "t2", message: big },
      { kind: "judge", at: "t3", questions: ["water"], verdict: { water: { type: "noul", probability: 0.9 } }, ms: 300 },
      { kind: "result", at: "t4", text: "That's water." },
    ],
    outcome: "none",
    ms: 212,
    truncated: true,
  });
  t.end();
});

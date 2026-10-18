// # Chat Schedule Parsing
//
// `parseScheduleTags` and `parseCancelScheduleTags` extract schedule instructions from assistant response text.

import { test } from "tap";
import "agent-doctest/tap";
import { parseScheduleTags, parseCancelScheduleTags, ChatScheduleManager, loadChatSchedules } from "../../../src/core/chat/schedules/core.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import * as fs from "node:fs";
import * as path from "node:path";

// ## Corrupt persisted schedule is skipped, valid ones still load (Track D.6)
//
// `chat-schedules.ts:198`'s persisted shape used to be an unvalidated
// `JSON.parse(...) as ChatSchedule[]` cast — a hand-edited or corrupted
// `firesAt` would parse to `NaN` and the timer would fire immediately. Loading
// now validates each entry against a zod schema (mirroring
// `location-store.ts`'s pattern): an invalid entry is skipped with a named
// warning, never silently, and never crashes the whole load.
const capturedLogs: string[] = [];
const originalConsoleLog = console.log;

// ## Deletion detaches and can restore linked schedules
void test("Deletion detaches and can restore linked schedules", async (t) => {
  t.teardown(async () => {
    try {
      manager.stopAll();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L15
  const box = await makeTmpBox();
  const manager = new ChatScheduleManager(box.root, { onFire: () => {} });
  const sessionId = "11111111-1111-4111-8111-111111111111";
  manager.addSchedule({ label: "linked", alarm: false, announce: null, content: "x", durationMs: 60_000, sessionId });
  manager.addSchedule({ label: "other", alarm: false, announce: null, content: "y", durationMs: 60_000, sessionId: "other" });
  manager.blockForDeletion(sessionId);
  const receipt = await manager.detachForSession(sessionId);
  t.check({ detached: receipt.schedules.map((s) => s.label), active: manager.getActive().map((s) => s.label) }, {
    detached: [
      "linked",
    ],
    active: [
      "other",
    ],
  });

  // doctest:L27
  manager.restoreDetachedSchedules(receipt);
  t.check(manager.getActive().map((schedule) => schedule.label).toSorted().join(","), "linked,other");
});

// ## Basic schedule tag
void test("Basic schedule tag", async (t) => {
  // doctest:L40
  const tags = parseScheduleTags('<schedule in="20m" label="rice timer" alarm="1" announce="check rice">Tell Ian to check the rice</schedule>');
  await t.checkText(tags.length, "1");

  // doctest:L46
  t.check(tags[0]?.alarm, true);

  // doctest:L49
  t.check(tags[0]?.announce, "check rice");
});

// ## Schedule without alarm or announce
void test("Schedule without alarm or announce", async (t) => {
  // doctest:L56
  const tags = parseScheduleTags('<schedule in="5m" label="break">Take a break</schedule>');
  t.check(tags[0]?.alarm, false);

  // doctest:L60
  t.check(tags[0]?.announce, null);

  // doctest:L63
  t.check(tags[0]?.durationMs, 300000);
});

// ## Multiple schedule tags
void test("Multiple schedule tags", async (t) => {
  // doctest:L70
  const text = 'Sure! <schedule in="10m" label="first">one</schedule> and <schedule in="30m" label="second">two</schedule>';
  const tags = parseScheduleTags(text);
  await t.checkText(tags.length, "2");

  // doctest:L75
  t.check(tags[0]?.label, "first");

  // doctest:L78
  t.check(tags[1]?.label, "second");
});

// ## Missing "in" attribute is skipped
void test("Missing \"in\" attribute is skipped", async (t) => {
  // doctest:L85
  const tags = parseScheduleTags('<schedule label="bad">no duration</schedule>');
  await t.checkText(tags.length, "0");
});

// ## Invalid duration is skipped
void test("Invalid duration is skipped", async (t) => {
  // doctest:L93
  const tags = parseScheduleTags('<schedule in="abc" label="bad">invalid</schedule>');
  await t.checkText(tags.length, "0");
});

// ## Default label
void test("Default label", async (t) => {
  // doctest:L101
  const tags = parseScheduleTags('<schedule in="1m">stuff</schedule>');
  t.check(tags[0]?.label, "timer");
});

// ## Duration units
void test("Duration units", async (t) => {
  // doctest:L109
  t.check(parseScheduleTags('<schedule in="30s" label="t">x</schedule>')[0]?.durationMs, 30000);

  // doctest:L112
  t.check(parseScheduleTags('<schedule in="2h" label="t">x</schedule>')[0]?.durationMs, 7200000);

  // doctest:L115
  t.check(parseScheduleTags('<schedule in="1d" label="t">x</schedule>')[0]?.durationMs, 86400000);
});

// ## Cancel schedule tags
void test("Cancel schedule tags", async (t) => {
  // doctest:L122
  const labels = parseCancelScheduleTags('OK I\'ll cancel it. <cancel-schedule label="rice timer" />');
  await t.checkText(labels.length, "1");

  // doctest:L126
  t.check(labels[0], "rice timer");
});

// ## Self-closing cancel without space before slash
void test("Self-closing cancel without space before slash", async (t) => {
  // doctest:L133
  const labels = parseCancelScheduleTags('<cancel-schedule label="test"/>');
  await t.checkText(labels.length, "1");

  // doctest:L137
  t.check(labels[0], "test");
});

// ## No tags returns empty
void test("No tags returns empty", async (t) => {
  // doctest:L144
  await t.checkText(parseScheduleTags("Just a normal response with no tags").length, "0");

  // doctest:L147
  await t.checkText(parseCancelScheduleTags("Nothing to cancel here").length, "0");
});

// ## Schedule mixed with other content
void test("Schedule mixed with other content", async (t) => {
  // doctest:L154
  const text = `<speech>I'll set a timer for you.</speech>

<schedule in="15m" alarm="1" label="pasta" announce="pasta is ready">Check the pasta on the stove</schedule>

Let me know if you need anything else.`;
  const tags = parseScheduleTags(text);
  await t.checkText(tags.length, "1");

  // doctest:L163
  t.check(tags[0]?.label, "pasta");

  // doctest:L166
  t.check(tags[0]?.content, "Check the pasta on the stove");
});

// ## ChatScheduleManager with custom storage path
//
// The `schedulesFile` option lets per-thread schedule managers use separate files:
void test("The schedulesFile option lets per-thread schedule managers use separate files:", async (t) => {
  t.teardown(async () => {
    try {
      manager.stopAll();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L175
  const box = await makeTmpBox({ git: true });
  const fired: string[] = [];
  const manager = new ChatScheduleManager(box.root, {
    schedulesFile: ".beebox/thread-schedules/test-thread.json",
    onFire: ({ schedule }) => { fired.push(schedule.label); },
  });
  const schedule = manager.addSchedule({ label: "test", alarm: false, announce: null, content: "hello", durationMs: 100 });
  t.check(schedule.label, "test");

  // doctest:L187
  // Wait for delivery admission and the callback, not a fixed timer margin.
  const deadline = Date.now() + 3000;
  while (fired.length === 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
  await t.checkText(fired.length, "1");

  // doctest:L193
  t.check(fired[0], "test");

  // doctest:L198
  // Verify it persisted to the custom path
  const filePath = path.join(box.root, ".beebox/thread-schedules/test-thread.json");
  t.check(fs.existsSync(filePath), true);
});

void test("Corrupt persisted schedule is skipped, valid ones still load (Track D.6)", async (t) => {
  t.teardown(async () => {
    try {
      manager2.stopAll();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L223
  const box2 = await makeTmpBox();
  const schedulesPath = ".beebox/schedules-corrupt-test.json";
  const absSchedulesPath = path.join(box2.root, schedulesPath);
  fs.mkdirSync(path.dirname(absSchedulesPath), { recursive: true });
  const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  fs.writeFileSync(absSchedulesPath, JSON.stringify([
    { id: "sch_good", label: "good one", alarm: false, announce: null, content: "hi", createdAt: "2026-01-01T00:00:00.000Z", firesAt: farFuture },
    { id: "sch_bad", label: "corrupt entry", alarm: false, announce: null, content: "hi", createdAt: "2026-01-01T00:00:00.000Z", firesAt: "not-a-date" },
  ]));

  // doctest:L233
  console.log = function (...args: unknown[]): void { capturedLogs.push(args.join(" ")); };
  const manager2 = new ChatScheduleManager(box2.root, { schedulesFile: schedulesPath, onFire: () => {} });
  console.log = originalConsoleLog;

  // doctest:L237
  t.check(manager2.getActive().map((s) => s.label), [
    "good one",
  ]);

  // The skip is logged by name, not silent:

  // doctest:L244
  await t.checkText(capturedLogs.some((line) => line.includes("corrupt entry")), "true");
});

// ## Originating session id round-trips through persistence
//
// A schedule records the id of the session whose turn created it, so the fire can
// land back in that conversation (`chat-schedule-fire.ts`). `addSchedule` accepts
// an optional `sessionId`, persists it, and `loadChatSchedules` reads it back:
void test("A schedule records the id of the session whose turn created it, so the fire c...", async (t) => {
  t.teardown(async () => {
    try {
      manager3.stopAll();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L259
  const box3 = await makeTmpBox();
  const schedulesPath3 = ".beebox/schedules-session-test.json";
  const manager3 = new ChatScheduleManager(box3.root, {
    schedulesFile: schedulesPath3,
    onFire: () => {},
  });
  const withSession = manager3.addSchedule({ label: "with", alarm: false, announce: null, content: "hi", durationMs: 3_600_000, sessionId: "sess-abc" });
  t.check(withSession.sessionId, "sess-abc");

  // doctest:L271
  // Reloading from disk preserves the session id.
  const reloaded = loadChatSchedules({ boxRoot: box3.root, schedulesFile: schedulesPath3 });
  t.check(reloaded.map((s) => ({ label: s.label, sessionId: s.sessionId ?? null })), [
    {
      label: "with",
      sessionId: "sess-abc",
    },
  ]);

  // doctest:L278
  // Omitting sessionId is allowed — the field just isn't written.
  const noSession = manager3.addSchedule({ label: "without", alarm: false, announce: null, content: "hi", durationMs: 3_600_000 });
  t.check(noSession.sessionId ?? null, null);
});

// ## Legacy entry without a session id still loads
//
// An entry persisted before the `sessionId` field existed stays valid — it loads
// and fires (falling back to the most-active session):
void test("An entry persisted before the sessionId field existed stays valid — it loads...", async (t) => {
  // doctest:L294
  const box4 = await makeTmpBox();
  const legacyPath = ".beebox/schedules-legacy.json";
  const absLegacy = path.join(box4.root, legacyPath);
  fs.mkdirSync(path.dirname(absLegacy), { recursive: true });
  const farFuture4 = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  fs.writeFileSync(absLegacy, JSON.stringify([
    { id: "sch_legacy", label: "old timer", alarm: false, announce: null, content: "hi", createdAt: "2026-01-01T00:00:00.000Z", firesAt: farFuture4 },
  ]));
  const legacy = loadChatSchedules({ boxRoot: box4.root, schedulesFile: legacyPath });
  t.check(legacy.map((s) => ({ label: s.label, sessionId: s.sessionId ?? null })), [
    {
      label: "old timer",
      sessionId: null,
    },
  ]);
});

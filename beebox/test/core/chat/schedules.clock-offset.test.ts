// # Check-ins run on the box clock
//
// A journey walk fixture (`fakeNotifications` in `_config/box.json`) with
// `.beebox/clock-offset.json` runs ahead of real time. A check-in made then is
// timed and shown in box time, and one armed before the offset is written
// fires once the offset moves box time past its `firesAt`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { eventually } from "@ianbicking/tap-check/check";
import * as fs from "node:fs";
import * as path from "node:path";
import { ChatScheduleManager } from "../../../src/core/chat/schedules/core.js";
import { clearTimeCache } from "../../../src/lib/time.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const base = { alarm: false, announce: null, content: "x" };
const DAY_MS = 24 * 60 * 60 * 1000;

async function makeWalkBox(): Promise<Awaited<ReturnType<typeof makeTmpBox>>> {
  const box = await makeTmpBox({ git: false });
  fs.mkdirSync(path.join(box.root, "_config"), { recursive: true });
  fs.writeFileSync(path.join(box.root, "_config/box.json"), JSON.stringify({ fakeNotifications: true }));
  return box;
}

function writeOffset(root: string, offsetMs: number): void {
  fs.mkdirSync(path.join(root, ".beebox"), { recursive: true });
  fs.writeFileSync(path.join(root, ".beebox/clock-offset.json"), JSON.stringify({ offsetMs }));
}

void test("a check-in made after an offset is 10 minutes away in box time", async (t) => {
  const box = await makeWalkBox();
  const manager = new ChatScheduleManager(box.root, { onFire: () => {} });
  t.teardown(async () => { manager.stopAll(); clearTimeCache(); await box.cleanup(); });
  writeOffset(box.root, 7 * DAY_MS);
  const schedule = manager.addSchedule({ ...base, label: "rice", durationMs: 10 * 60_000 });
  t.check({
    daysAhead: Math.round((new Date(schedule.createdAt).getTime() - Date.now()) / DAY_MS),
    minutesAway: (new Date(schedule.firesAt).getTime() - new Date(schedule.createdAt).getTime()) / 60_000,
    pending: manager.formatPendingForPrompt(),
    active: manager.getActive().map((s) => s.label),
  }, {
    daysAhead: 7,
    minutesAway: 10,
    pending: 'Active check-ins:\n- "rice" fires in 10m',
    active: ["rice"],
  });
});

void test("a check-in armed before an offset fires once the offset passes it", async (t) => {
  const box = await makeWalkBox();
  const fired: string[] = [];
  const manager = new ChatScheduleManager(box.root, { onFire: ({ schedule }) => { fired.push(schedule.label); }, clockWatchIntervalMs: 20 });
  t.teardown(async () => { manager.stopAll(); clearTimeCache(); await box.cleanup(); });
  manager.addSchedule({ ...base, label: "soon", durationMs: 10 * 60_000 });
  t.check(fired, []);
  writeOffset(box.root, 60 * 60_000);
  await eventually(() => fired.length === 1, { label: "the check-in fires after the offset" });
  t.check({ fired, active: manager.getActive() }, { fired: ["soon"], active: [] });
});

void test("the clock watcher runs only while a check-in is armed", async (t) => {
  const box = await makeWalkBox();
  const manager = new ChatScheduleManager(box.root, { onFire: () => {} });
  t.teardown(async () => { manager.stopAll(); clearTimeCache(); await box.cleanup(); });
  const idle = manager.isWatchingClock();
  manager.addSchedule({ ...base, label: "rice", durationMs: 10 * 60_000 });
  const armed = manager.isWatchingClock();
  manager.cancelByLabel("rice");
  const cancelled = manager.isWatchingClock();
  manager.addSchedule({ ...base, label: "tea", durationMs: 10 * 60_000, sessionId: "s1" });
  const rearmed = manager.isWatchingClock();
  manager.pauseForMaintenance();
  t.check({ idle, armed, cancelled, rearmed, paused: manager.isWatchingClock() }, { idle: false, armed: true, cancelled: false, rearmed: true, paused: false });
});

// # Check-ins are short, saved before they are armed, and never overflow
//
// A check-in keeps one conversation going. Anything longer than
// `CHECK_IN_MAX_MS` (12 h) is a reminder card, so `addSchedule` refuses it.
// Node turns a `setTimeout` delay over 2^31-1 ms (about 24.8 days) into 1 ms,
// which once fired a 30-day chat timer at once; an entry saved before the cap
// must still wait out its time. A check-in reported as set must also be on
// disk, so a save failure undoes it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs";
import * as path from "node:path";
import { ChatScheduleManager, parseScheduleTags } from "../../../src/core/chat/schedules/core.js";
import { CHECK_IN_MAX_MS } from "../../../src/core/chat/schedules/core.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const base = { alarm: false, announce: null, content: "x" };

void test("a 20-minute check-in is set; a 13-hour one is refused", async (t) => {
  const box = await makeTmpBox();
  const manager = new ChatScheduleManager(box.root, { onFire: () => {} });
  t.teardown(async () => { manager.stopAll(); await box.cleanup(); });
  manager.addSchedule({ ...base, label: "rice", durationMs: 20 * 60_000 });
  await t.checkThrows(() => manager.addSchedule({ ...base, label: "tomorrow", durationMs: 13 * 60 * 60_000 }), "CheckInTooLongError: A check-in can be at most 12h (asked for 780m); for longer, set a reminder with bbx remind --in or --at");
  t.check(manager.getActive().map((s) => s.label), ["rice"]);
  t.check(CHECK_IN_MAX_MS, 43_200_000);
});

void test("a check-in that cannot be saved is not set", async (t) => {
  const box = await makeTmpBox();
  // A directory where the file should be makes the write fail.
  fs.mkdirSync(path.join(box.root, ".beebox", "chat-schedules.json"), { recursive: true });
  const manager = new ChatScheduleManager(box.root, { onFire: () => {} });
  t.teardown(async () => { manager.stopAll(); await box.cleanup(); });
  await t.checkThrows(() => manager.addSchedule({ ...base, label: "rice", durationMs: 60_000 }), "CheckInNotSavedError: The check-in could not be saved, so it was not set");
  t.check(manager.getActive(), []);
});

void test("an entry saved 30 days out before the cap waits instead of firing", async (t) => {
  const box = await makeTmpBox();
  const file = path.join(box.root, ".beebox", "chat-schedules.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const firesAt = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
  fs.writeFileSync(file, JSON.stringify([{ id: "sch_old", label: "tape measure", ...base, createdAt: new Date().toISOString(), firesAt }]));
  const warnings: string[] = [];
  const onWarning = (w: Error): void => { warnings.push(w.name); };
  process.on("warning", onWarning);
  let fired = 0;
  const manager = new ChatScheduleManager(box.root, { onFire: () => { fired++; } });
  t.teardown(async () => { process.off("warning", onWarning); manager.stopAll(); await box.cleanup(); });
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  t.check({ fired, warnings, active: manager.getActive().map((s) => s.label) }, { fired: 0, warnings: [], active: ["tape measure"] });
});

void test("an unreadable tag is reported, not only logged", async (t) => {
  const rejected: string[] = [];
  const tags = parseScheduleTags('<schedule label="no time">x</schedule><schedule in="1mo" label="month">y</schedule><schedule in="5m" label="ok">z</schedule>', {
    onRejected: (label, reason) => { rejected.push(`${label}: ${reason}`); },
  });
  t.check(tags.map((tag) => tag.label), ["ok"]);
  t.check(rejected.map((line) => line.split(" (")[0]), ["no time: it has no in= attribute", 'month: in="1mo" is not a duration']);
});

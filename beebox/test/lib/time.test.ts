// # Time Utilities
//
// Stubbable time for scenario testing. Resolution: `BBX_TIME` env var → `stubs.yaml` in parent dir → real time.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { getBoxTime, getBoxTimeISO, clearTimeCache } from "../../src/lib/time.js";
import { makeTmpBox } from "../helpers/test-helpers.js";
import * as fs from "node:fs";
import * as path from "node:path";

// ## Default: real time
//
// Without any stubs, `getBoxTime()` returns approximately now:
void test("Without any stubs, getBoxTime() returns approximately now:", async (t) => {
  const now = Date.now();
  t.check(getBoxTime().getTime(), any(Number).between(now - 999, now + 999));
});

// ## BBX_TIME environment variable
//
// The `BBX_TIME` env var overrides time globally:
void test("The BBXTIME env var overrides time globally:", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env.BBX_TIME;
    } catch (error) {
      t.error(error);
    }
  });
  process.env.BBX_TIME = "2025-06-15T12:00:00Z";
  t.check(getBoxTime().toISOString(), "2025-06-15T12:00:00.000Z");

  t.check(getBoxTimeISO(), "2025-06-15T12:00:00.000Z");
});

// ## BBX_TIME takes priority over stubs.yaml
void test("BBX_TIME takes priority over stubs.yaml", async (t) => {
  t.teardown(async () => {
    try {
      delete process.env.BBX_TIME;
      fs.unlinkSync(stubsPath);
      clearTimeCache();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const stubsPath = path.join(box.root, "../stubs.yaml");
  fs.writeFileSync(stubsPath, "time: 2025-01-01T00:00:00Z\n");
  clearTimeCache();
  process.env.BBX_TIME = "2025-12-25T00:00:00Z";
  t.check(getBoxTimeISO(box.root), "2025-12-25T00:00:00.000Z");
});

// ## stubs.yaml in parent directory
//
// When a `stubs.yaml` file exists in the parent of the box root, its `time` field is used:
void test("When a stubs.yaml file exists in the parent of the box root, its time field i...", async (t) => {
  t.teardown(async () => {
    try {
      fs.unlinkSync(stubsPath);
      clearTimeCache();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const stubsPath = path.join(box.root, "../stubs.yaml");
  fs.writeFileSync(stubsPath, "time: 2025-07-04T10:30:00Z\n");
  clearTimeCache();
  t.check(getBoxTimeISO(box.root), "2025-07-04T10:30:00.000Z");
});

// ## Missing stubs.yaml falls back to real time
void test("Missing stubs.yaml falls back to real time", async (t) => {
  t.teardown(async () => {
    try {
      clearTimeCache();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  clearTimeCache();
  const now = Date.now();
  t.check(getBoxTime(box.root).getTime(), any(Number).between(now - 999, now + 999));
});

// ## Cache persists across calls
//
// The stubs.yaml result is cached per box root:
void test("The stubs.yaml result is cached per box root:", async (t) => {
  t.teardown(async () => {
    try {
      fs.unlinkSync(stubsPath);
      clearTimeCache();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const stubsPath = path.join(box.root, "../stubs.yaml");
  fs.writeFileSync(stubsPath, "time: 2025-03-01T00:00:00Z\n");
  clearTimeCache();
  const first = getBoxTimeISO(box.root);
  fs.writeFileSync(stubsPath, "time: 2025-09-01T00:00:00Z\n");
  t.check([first, getBoxTimeISO(box.root)], ["2025-03-01T00:00:00.000Z", "2025-03-01T00:00:00.000Z"]);
});

// ## clearTimeCache resets the cache
void test("clearTimeCache resets the cache", async (t) => {
  t.teardown(async () => {
    try {
      fs.unlinkSync(stubsPath);
      clearTimeCache();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const stubsPath = path.join(box.root, "../stubs.yaml");
  fs.writeFileSync(stubsPath, "time: 2025-03-01T00:00:00Z\n");
  clearTimeCache();
  const first = getBoxTimeISO(box.root);
  fs.writeFileSync(stubsPath, "time: 2025-09-01T00:00:00Z\n");
  clearTimeCache();
  t.check([first, getBoxTimeISO(box.root)], ["2025-03-01T00:00:00.000Z", "2025-09-01T00:00:00.000Z"]);
});

// ## The box clock offset
//
// A journey walk fixture (any `fakeNotifications` key in `_config/box.json`)
// with `.beebox/clock-offset.json` runs ahead of real time by `offsetMs`. On any
// other box the file is ignored, `BBX_TIME` still wins, and a malformed file
// reads as no offset. Both files are re-read when they change, with no restart.
void test("The box clock offset", async (t) => {
  const { boxClockShiftMs, storedClockOffsetMs } = await import("../../src/lib/time.js");
  const fixture = await makeTmpBox({ git: false });
  const plain = await makeTmpBox({ git: false });
  t.teardown(async () => {
    delete process.env.BBX_TIME;
    clearTimeCache();
    await fixture.cleanup();
    await plain.cleanup();
  });
  const week = 7 * 24 * 60 * 60 * 1000;
  const write = (root: string, { rel, value }: { rel: string; value: unknown }) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), typeof value === "string" ? value : JSON.stringify(value));
  };
  write(fixture.root, { rel: "_config/box.json", value: { fakeNotifications: true } });
  write(fixture.root, { rel: ".beebox/clock-offset.json", value: { offsetMs: week, setAt: "2026-10-23T00:00:00Z" } });
  write(plain.root, { rel: ".beebox/clock-offset.json", value: { offsetMs: week } });
  const ahead = (root: string) => Math.round((getBoxTime(root).getTime() - Date.now()) / 60_000);
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.map(String).join(" ")); };

  const before = { fixture: ahead(fixture.root), plain: ahead(plain.root), shift: Math.round(boxClockShiftMs(fixture.root) / 60_000), plainShift: boxClockShiftMs(plain.root), stored: storedClockOffsetMs(plain.root) };
  process.env.BBX_TIME = "2026-01-01T00:00:00Z";
  const frozen = getBoxTime(fixture.root).toISOString();
  delete process.env.BBX_TIME;
  // A later mtime, so the cache sees the change.
  write(fixture.root, { rel: ".beebox/clock-offset.json", value: "{ not json" });
  fs.utimesSync(path.join(fixture.root, ".beebox/clock-offset.json"), new Date(), new Date(Date.now() + 5000));
  const malformed = ahead(fixture.root);
  console.warn = origWarn;

  t.check({ before, frozen, malformed, warned: warnings.filter((w) => w.includes("clock-offset.json")).map((w) => w.replace(fixture.root, "<box>").split(":")[0]) }, {
    before: { fixture: 7 * 24 * 60, plain: 0, shift: 7 * 24 * 60, plainShift: 0, stored: week },
    frozen: "2026-01-01T00:00:00.000Z",
    malformed: 0,
    warned: ["[time] could not read <box>/.beebox/clock-offset.json; using no offset"],
  });
});

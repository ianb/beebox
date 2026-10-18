// # Time Utilities
//
// Stubbable time for scenario testing. Resolution: `BBX_TIME` env var → `stubs.yaml` in parent dir → real time.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import { getBoxTime, getBoxTimeISO, clearTimeCache } from "../../src/lib/time.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import * as fs from "node:fs";
import * as path from "node:path";

// ## Default: real time
//
// Without any stubs, `getBoxTime()` returns approximately now:
void test("Without any stubs, getBoxTime() returns approximately now:", async (t) => {
  // doctest:L17
  const now = Date.now();
  const boxTime = getBoxTime();
  await t.checkText(Math.abs(boxTime.getTime() - now) < 1000, "true");
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
  // doctest:L28
  process.env.BBX_TIME = "2025-06-15T12:00:00Z";
  t.check(getBoxTime().toISOString(), "2025-06-15T12:00:00.000Z");

  // doctest:L34
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
  // doctest:L45
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
  // doctest:L66
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
  // doctest:L83
  const box = await makeTmpBox();
  clearTimeCache();
  const now = Date.now();
  const boxTime = getBoxTime(box.root);
  await t.checkText(Math.abs(boxTime.getTime() - now) < 1000, "true");
});

// ## Cache persists across calls
//
// The stubs.yaml result is cached per box root:
void test("The stubs.yaml result is cached per box root:", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      fs.unlinkSync(stubsPath);
      clearTimeCache();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L101
  const box = await makeTmpBox();
  const stubsPath = path.join(box.root, "../stubs.yaml");
  fs.writeFileSync(stubsPath, "time: 2025-03-01T00:00:00Z\n");
  clearTimeCache();
  print(getBoxTimeISO(box.root));
  fs.writeFileSync(stubsPath, "time: 2025-09-01T00:00:00Z\n");
  await t.checkText(out.with(print(getBoxTimeISO(box.root))), `2025-03-01T00:00:00.000Z
2025-03-01T00:00:00.000Z`);
});

// ## clearTimeCache resets the cache
void test("clearTimeCache resets the cache", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      fs.unlinkSync(stubsPath);
      clearTimeCache();
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L122
  const box = await makeTmpBox();
  const stubsPath = path.join(box.root, "../stubs.yaml");
  fs.writeFileSync(stubsPath, "time: 2025-03-01T00:00:00Z\n");
  clearTimeCache();
  print(getBoxTimeISO(box.root));
  fs.writeFileSync(stubsPath, "time: 2025-09-01T00:00:00Z\n");
  clearTimeCache();
  await t.checkText(out.with(print(getBoxTimeISO(box.root))), `2025-03-01T00:00:00.000Z
2025-09-01T00:00:00.000Z`);
});

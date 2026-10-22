// # Scheduler Utilities
//
// Tests for scheduler utility functions — box validation.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isBox } from "../../../src/core/schedule/scheduler/core.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ## isBox
//
// ### A scaffolded box is a box (package.json declaring beebox beside _config/)
void test("A scaffolded box is a box", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const result = await isBox(box.root);
  t.check(result, true);
});

// ### Directory without marker is not a box
void test("Directory without marker is not a box", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true });
    } catch (error) {
      t.error(error);
    }
  });
  const tmpDir = await fs.mkdtemp(path.join(await import("node:os").then(m => m.tmpdir()), "not-a-box-"));
  const result = await isBox(tmpDir);
  t.check(result, false);
});

// ### Nonexistent directory is not a box
void test("Nonexistent directory is not a box", async (t) => {
  const result = await isBox("/tmp/nonexistent-box-test-12345");
  t.check(result, false);
});

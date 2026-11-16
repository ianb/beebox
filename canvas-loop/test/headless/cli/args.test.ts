import assert from "node:assert/strict";
import { test } from "node:test";
import { sceneArgs } from "../../../src/headless/cli/args.js";

test("--scene alone outlines every captured frame; --scene first only the first", () => {
  assert.deepEqual(sceneArgs(["s.ts", "--scene", "--frames", "4"]), ["s.ts", "--scene=all", "--frames", "4"]);
  assert.deepEqual(sceneArgs(["s.ts", "--scene", "first", "--frames", "4"]), ["s.ts", "--scene=first", "--frames", "4"]);
});

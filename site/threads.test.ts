import assert from "node:assert/strict";
import { test } from "node:test";
import { NAVIGATION_SCRIPT } from "./navigation-script.js";

test("the navigation script, with the threads code inlined, is valid JavaScript", () => {
  assert.doesNotThrow(() => new Function(NAVIGATION_SCRIPT));
  assert.match(NAVIGATION_SCRIPT, /function runThreads\(\)/);
});

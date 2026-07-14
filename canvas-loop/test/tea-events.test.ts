import assert from "node:assert/strict";
import { test } from "node:test";
import { EventScriptError } from "../src/headless/errors.js";
import { parseTeaEvents } from "../src/headless/tea-events.js";
import type { ParamsDecl } from "../src/core/tea.js";

const decl: ParamsDecl = {
  speed: { type: "number", min: 0, max: 5, default: 1 },
  trails: { type: "boolean", default: false },
  palette: { type: "select", options: ["warm", "cool"], default: "warm" },
  burst: { type: "trigger" },
};

test("valid param and trigger events parse against the declaration", () => {
  const events = parseTeaEvents(
    [
      { frame: 1, type: "param", name: "speed", value: 2.5 },
      { frame: 2, type: "param", name: "trails", value: true },
      { frame: 3, type: "param", name: "palette", value: "cool" },
      { frame: 4, type: "trigger", name: "burst" },
      { frame: 5, type: "mousedown", x: 10, y: 20 },
    ],
    decl,
  );
  assert.equal(events.length, 5);
  assert.deepEqual(events[0], { frame: 1, type: "param", name: "speed", value: 2.5 });
});

test("an unknown param name is a clear error", () => {
  assert.throws(
    () => parseTeaEvents([{ frame: 0, type: "param", name: "nope", value: 1 }], decl),
    (e: unknown) => e instanceof EventScriptError && e.message.includes('no declared param named "nope"'),
  );
});

test("a wrong value type for a number param is a clear error", () => {
  assert.throws(
    () => parseTeaEvents([{ frame: 0, type: "param", name: "speed", value: "fast" }], decl),
    (e: unknown) => e instanceof EventScriptError && e.message.includes('param "speed" expects a finite number'),
  );
});

test("a select value outside its options is a clear error", () => {
  assert.throws(
    () => parseTeaEvents([{ frame: 0, type: "param", name: "palette", value: "neon" }], decl),
    (e: unknown) => e instanceof EventScriptError && e.message.includes('param "palette" expects one of'),
  );
});

test("setting a value on a trigger param is a clear error", () => {
  assert.throws(
    () => parseTeaEvents([{ frame: 0, type: "param", name: "burst", value: 1 }], decl),
    (e: unknown) => e instanceof EventScriptError && e.message.includes("is a trigger"),
  );
});

test("triggering a non-trigger param is a clear error", () => {
  assert.throws(
    () => parseTeaEvents([{ frame: 0, type: "trigger", name: "speed" }], decl),
    (e: unknown) => e instanceof EventScriptError && e.message.includes('param "speed" is a number, not a trigger'),
  );
});

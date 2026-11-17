import assert from "node:assert/strict";
import { test } from "node:test";
import { EventScriptError } from "../../src/headless/errors.js";
import { parseTeaEvents } from "../../src/headless/tea-events.js";
import type { ParamsDecl } from "../../src/core/tea.js";

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

test("a mouse entry aims by target, and target with x or y, or an empty target, is an error", () => {
  assert.deepEqual(parseTeaEvents([{ frame: 3, type: "mousedown", target: "pan-left" }], decl), [{ frame: 3, type: "mousedown", target: "pan-left" }]);
  const bad = (entry: object, text: string): void => {
    assert.throws(() => parseTeaEvents([entry], decl), (e: unknown) => e instanceof EventScriptError && e.message.includes(text));
  };
  bad({ frame: 3, type: "mousedown", target: "pan-left", x: 4 }, 'event[0]: give "target" or "x" and "y", not both');
  bad({ frame: 3, type: "mouseup", target: "pan-left", y: 4 }, "not both");
  bad({ frame: 3, type: "mousemove", target: "" }, '"target" must be a non-empty string');
  bad({ frame: 3, type: "mousedown", target: 7 }, '"target" must be a non-empty string');
});

test("a mouseleave has only a frame and a type", () => {
  assert.deepEqual(parseTeaEvents([{ frame: 9, type: "mouseleave" }], decl), [{ frame: 9, type: "mouseleave" }]);
  assert.throws(() => parseTeaEvents([{ frame: 9, type: "mouseleave", x: -20 }], decl), (e: unknown) => e instanceof EventScriptError && e.message.includes('event[0]: a mouseleave has no position or target, only "frame" and "type"; got "x"'));
});

test("a mousepath becomes one mousemove a frame along its points at an even speed, in its place in file order; the moves between its ends are quiet", () => {
  const events = parseTeaEvents([
    { frame: 4, type: "mousedown", x: 0, y: 0 },
    { frame: 4, type: "mousepath", points: [[0, 0], [30, 0], [30, 10]], frames: 4 },
    { frame: 6, type: "keydown", key: "a" },
    { frame: 8, type: "mouseup", x: 30, y: 10 },
  ], decl);
  assert.deepEqual(events, [
    { frame: 4, type: "mousedown", x: 0, y: 0 },
    { frame: 4, type: "mousemove", x: 0, y: 0 },
    { frame: 5, type: "mousemove", x: 10, y: 0, quiet: true },
    { frame: 6, type: "mousemove", x: 20, y: 0, quiet: true },
    { frame: 7, type: "mousemove", x: 30, y: 0, quiet: true },
    { frame: 8, type: "mousemove", x: 30, y: 10 },
    { frame: 6, type: "keydown", key: "a" },
    { frame: 8, type: "mouseup", x: 30, y: 10 },
  ]);
  const bad = (entry: object, text: string): void => {
    assert.throws(() => parseTeaEvents([entry], decl), (e: unknown) => e instanceof EventScriptError && e.message.includes(text));
  };
  bad({ frame: 1, type: "mousepath", points: [[0, 0]], frames: 3 }, '"points" must be a list of two or more [x, y] pairs');
  bad({ frame: 1, type: "mousepath", points: [[0, 0], [1, "a"]], frames: 3 }, '"points" must be');
  bad({ frame: 1, type: "mousepath", points: [[0, 0], [1, 1]], frames: 0 }, '"frames" must be a whole number 1..3599');
  bad({ frame: 1, type: "mousepath", points: [[0, 0], [1, 1]], frames: 2, to: [3, 3] }, 'a mousepath takes "frame", "type", "points" and "frames"; got "to"');
});

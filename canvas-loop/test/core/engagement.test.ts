// Transcript lines for scripted input (plan:canvas-loop-layout-text-hits.subplan,
// chunk B2): a mouse line names what it landed on, and repeated "(unhandled)"
// lines fold per type and target path, so a named click the sketch ignored
// still shows after a miss in empty space.
import assert from "node:assert/strict";
import { test } from "node:test";
import { UnhandledFold, describeInput } from "../../src/core/engagement.js";

const down = (targets: readonly string[]) => ({ type: "mousedown" as const, x: 297, y: 288, target: targets[0], targets });

test("describeInput: a mouse line says on X, and on X in Y when nested; nothing when no name is under it", () => {
  assert.equal(describeInput(down([])), "mousedown (297,288)");
  assert.equal(describeInput(down(["pan-left"])), "mousedown (297,288) on pan-left");
  assert.equal(describeInput(down(["weight-2", "pan-left"])), "mousedown (297,288) on weight-2 in pan-left");
  assert.equal(describeInput({ type: "keydown", key: "ArrowUp" }), "keydown ArrowUp");
});

test("UnhandledFold: a named unhandled click shows after a miss in empty space; repeats of each path fold", () => {
  const fold = new UnhandledFold();
  const shown = [down([]), down([]), down(["pan-left"]), down(["pan-left"]), down(["weight-2", "pan-left"])].map((m) => fold.show(m, "(unhandled)"));
  assert.deepEqual(shown, [true, false, true, false, true]);
  assert.equal(fold.show(down([]), "add-weight"), true, "a handled line always shows");
  assert.deepEqual(fold.summary(), ["mousedown: 1 more unhandled (not listed)", "mousedown on pan-left: 1 more unhandled (not listed)"]);
});

test("UnhandledFold: two target paths that print alike still each show once", () => {
  const fold = new UnhandledFold();
  assert.deepEqual([down(["a in b"]), down(["a", "b"])].map((m) => fold.show(m, "(unhandled)")), [true, true]);
});

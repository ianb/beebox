// Scripted aim (plan:canvas-loop-layout-text-hits.subplan, chunk B3) on
// recorded scenes: the centre of the layout box of the topmost drawing with
// the name, on the canvas and rounded, at any depth and inside placements; an
// error naming the frame, the name and what the centre hit otherwise.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { Drawing, View } from "../../src/core/tea.js";
import type { TextMeasurer } from "../../src/core/text/measure.js";
import { openTextMeasurer } from "../../src/device/open.js";
import { EventScriptError } from "../../src/headless/errors.js";
import { aimAt } from "../../src/headless/tea-runtime/aim.js";
import type { Scene } from "../../src/scene/nodes.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";

let text: TextMeasurer | undefined;
before(async () => {
  text = await openTextMeasurer();
});

function scene(draw: (v: View) => Drawing): Scene {
  if (text === undefined) throw new Error("no text measurer");
  return new SceneRecorder({ width: 300, height: 200 }, { text }).record(draw).scene;
}

const FILL = { fill: "#888" } as const;
const aim = (s: Scene | undefined, target: string) => aimAt(s, { frame: 30, type: "mousedown", target });
const fails = (s: Scene | undefined, a: { target: string; says: string }): void => {
  assert.throws(() => aim(s, a.target), (e: unknown) => e instanceof EventScriptError && e.message.includes(a.says));
};

test("aims at the centre of the named drawing's box on the canvas, rounded, through scopes and placements", () => {
  const s = scene((v) => {
    const weight = v.picture({ key: "w", width: 10, height: 10 }, () => v.rect(0, 0, 10, 10, { ...FILL, name: "weight" }));
    return [v.at({ translate: [100, 50], name: "pan" }, [v.rect(-40, 0, 80, 20, FILL), v.place(weight, 3, 2)]), v.rect(10, 10, 5, 5, { ...FILL, name: "odd" })];
  });
  assert.deepEqual(aim(s, "odd").point, [13, 13], "a centre at (12.5, 12.5) rounds as the browser does");
  assert.deepEqual(aim(s, "pan"), { point: [100, 60], hit: { target: "pan", targets: ["pan"] } });
  assert.deepEqual(aim(s, "weight"), { point: [108, 57], hit: { target: "weight", targets: ["weight", "pan"] } });
});

test("of two drawings with the name, the topmost is aimed at", () => {
  const s = scene((v) => [v.circle(50, 50, 10, { ...FILL, name: "dot" }), v.circle(150, 50, 10, { ...FILL, name: "dot" })]);
  assert.deepEqual(aim(s, "dot").point, [150, 50]);
});

test("frame 0, a missing name and a centre that lands elsewhere stop the run with what the centre hit", () => {
  fails(undefined, { target: "pan-left", says: 'frame 30: mousedown target "pan-left": nothing is drawn before frame 0' });
  const s = scene((v) => [
    v.circle(50, 50, 30, { stroke: "#000", weight: 4, name: "ring" }),
    v.rect(120, 20, 60, 60, { ...FILL, name: "pan-left" }),
    v.rect(140, 40, 20, 20, { ...FILL, name: "weight-2" }),
  ]);
  fails(s, { target: "pan-right", says: 'frame 30: mousedown target "pan-right": no drawing named so, with a size, in the scene drawn at frame 29' });
  fails(s, { target: "ring", says: 'target "ring": its centre (50,50) lands on no named drawing; aim with x and y' });
  fails(s, { target: "pan-left", says: 'target "pan-left": its centre (150,50) lands on "weight-2"; aim with x and y' });
});

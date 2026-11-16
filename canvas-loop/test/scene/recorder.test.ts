// The scene recorder: draft 2.2 calls become scene nodes, captured by value;
// calls the recorder does not support yet fail naming the call.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SketchUsageError } from "../../src/core/errors.js";
import type { LinearGradient, PathCommand, Vec2 } from "../../src/core/paint.js";
import type { Effects, View } from "../../src/core/tea.js";
import { UnsupportedCallError } from "../../src/scene/errors.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";
import { sceneOutline } from "../../src/scene/outline.js";

const recorder = (): SceneRecorder => new SceneRecorder({ width: 100, height: 80 });

test("arguments are captured by value: changing them after the call changes nothing recorded", () => {
  const points: Vec2[] = [[0, 0], [10, 0], [10, 10]];
  const commands: PathCommand[] = [["move", 0, 0], ["line", 5, 5]];
  const stops: [number, string][] = [[0, "#000"], [1, "#fff"]];
  const gradient: LinearGradient = { kind: "linear-gradient", x1: 0, y1: 0, x2: 10, y2: 0, stops };
  const effects: { blur: number } = { blur: 2 };
  const style: { fill: string; effects: Effects } = { fill: "#ff0000", effects };
  const scene = recorder().record((v) => {
    v.polygon(points, style);
    v.path(commands, { stroke: gradient });
  }).scene;
  points[0] = [99, 99];
  commands[1] = ["line", 50, 50];
  stops[0] = [0, "#123456"];
  style.fill = "#00ff00";
  effects.blur = 9;
  const [poly, path] = scene.children;
  assert.ok(poly?.kind === "shape" && poly.geom.kind === "poly");
  assert.deepEqual(poly.geom.points[0], [0, 0]);
  assert.equal(poly.style.fill, "#ff0000");
  assert.deepEqual(poly.style.effects, { blur: 2 });
  assert.ok(path?.kind === "shape" && path.geom.kind === "path");
  assert.deepEqual(path.geom.commands[1], ["line", 5, 5]);
  assert.ok(typeof path.style.stroke === "object");
  assert.deepEqual(path.style.stroke.stops[0], [0, "#000"]);
});

test("scopes nest as nodes; at composes its matrix and toCanvas follows it", () => {
  let corner: Vec2 = [0, 0];
  const rec = recorder().record((v) => {
    v.at({ translate: [10, 20], scale: 2 }, () => {
      corner = v.toCanvas([1, 1]);
      v.group({ opacity: 0.5, name: "g", clip: [[0, 0], [5, 0], [0, 5]] }, () => v.clip([[[0, 0], [4, 0], [0, 4]], [[1, 1], [3, 1], [1, 3]]], () => v.circle(0, 0, 3, { fill: "red" })));
    });
    v.mask(() => v.rect(0, 0, 5, 5, { fill: "#000" }), () => v.rect(0, 0, 5, 5, { fill: "blue" }));
  });
  assert.deepEqual(corner, [12, 22]);
  const at = rec.scene.children[0];
  assert.ok(at?.kind === "at");
  assert.deepEqual(at.matrix, [2, 0, 0, 2, 10, 20]);
  const group = at.children[0];
  assert.ok(group?.kind === "group");
  assert.equal(group.name, "g");
  assert.equal(group.clip?.length, 1);
  const clip = group.children[0];
  assert.ok(clip?.kind === "clip");
  assert.equal(clip.shapes.length, 2);
  assert.equal(rec.scene.children[1]?.kind, "mask");
  assert.match(sceneOutline(rec.scene), /group "g" opacity 0.5 blend normal clip 1\n {6}clip 2 shapes\n {8}circle/);
});

test("log, snapshot, cursor and debugBox are kept beside the scene", () => {
  const rec = recorder().record((v) => {
    v.log("x", 1);
    v.snapshot("peak");
    v.cursor("pointer");
    v.cursor("grab");
    v.at({ translate: [5, 5] }, () => v.debugBox("hit", 0, 0, 2, 2));
  });
  assert.deepEqual(rec.logs, ["x 1"]);
  assert.deepEqual(rec.snapshots, ["peak"]);
  assert.equal(rec.cursor, "grab");
  assert.deepEqual(rec.debugBoxes[0]?.corners[2], [7, 7]);
});

test("a call or option the recorder does not support yet throws, naming it", () => {
  const cases: [string, (v: Parameters<Parameters<SceneRecorder["record"]>[0]>[0]) => void][] = [
    // style.dash was here until the drawing-round fixes; a blur under a skew is the one left.
    ["group effects under a rotated non-uniform scale or a skew", (v) => v.at({ skew: [0.4, 0] }, () => v.group({ effects: { blur: 2 } }, () => v.rect(0, 0, 1, 1, { fill: "#000" })))],
  ];
  for (const [call, draw] of cases) {
    assert.throws(() => recorder().record(draw), (e: unknown) => e instanceof UnsupportedCallError && e.call === call && e.message.includes("not supported yet"), call);
  }
});

test("misuse fails at the call, as today", () => {
  const usage = (message: RegExp) => (e: unknown): boolean => e instanceof SketchUsageError && message.test(e.message);
  // @ts-expect-error -- a key the Style type does not have; the runtime must refuse it
  assert.throws(() => recorder().record((v) => v.rect(0, 0, 1, 1, { fill: "#000", colour: "red" })), usage(/unknown style key "colour"/));
  // @ts-expect-error -- not a Canvas2D line cap
  assert.throws(() => recorder().record((v) => v.line(0, 0, 1, 1, { stroke: "#000", cap: "flat" })), usage(/style.cap must be butt, round or square/));
  // @ts-expect-error -- not a blend mode
  assert.throws(() => recorder().record((v) => v.rect(0, 0, 1, 1, { fill: "#000", blend: "plus" })), usage(/blend "plus" is not one of/));
  assert.throws(() => recorder().record((v) => v.rect(0, 0, 1, 1, { fill: "#000", effects: { blur: -1 } })), usage(/group effects: blur must be a number ≥ 0/));
  assert.throws(() => recorder().record((v) => v.group({ opacity: 2 }, () => {})), /group opacity must be a number in 0..1/);
});

test("a number that is not finite is an error naming the call's argument", () => {
  const cases: readonly [(v: View) => void, RegExp][] = [
    [(v) => v.line(0, 0, Number.NaN, 4, { stroke: "#000" }), /line: x2 must be a finite number, got NaN/],
    [(v) => v.triangle(0, 0, 1, 1, 2, Infinity, { fill: "#000" }), /triangle: y3 must be a finite number, got Infinity/],
    [(v) => v.path([["move", 0, 0], ["line", 1, Number.NaN]], { stroke: "#000" }), /path: command 1 \(line\) must hold finite numbers/],
    // A command with an extra element is kept whole, so the bad number is still reported.
    // @ts-expect-error -- a line command with three numbers
    [(v) => v.path([["move", 0, 0], ["line", 1, 2, Number.NaN]], { stroke: "#000" }), /path: command 1 \(line\) must hold finite numbers, got \[line, 1, 2, NaN]/],
    [(v) => v.ellipse(0, 0, 3, -1, { fill: "#000" }), /ellipse: ry must be a finite number ≥ 0, got -1/],
    [(v) => v.at({ scale: [1, Number.NaN] }, () => {}), /at: scale\[1] must be a finite number, got NaN/],
  ];
  for (const [draw, message] of cases) assert.throws(() => recorder().record(draw), (e: unknown) => e instanceof SketchUsageError && message.test(e.message));
});

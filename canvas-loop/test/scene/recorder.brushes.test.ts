// Brushed strokes, paper and text in the recorder: the blend R1 chooses,
// smear errors (R2), paper scopes (R9), and text measured at the call
// (section 7) with today's numbers.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { SketchUsageError } from "../../src/core/errors.js";
import type { TextMeasurer } from "../../src/core/text/measure.js";
import type { View } from "../../src/core/tea.js";
import { openTextMeasurer } from "../../src/device/open.js";
import { UnsupportedCallError } from "../../src/scene/errors.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";
import type { SceneNode, ShapeNode } from "../../src/scene/nodes.js";

const usage = (message: RegExp) => (e: unknown): boolean => e instanceof SketchUsageError && message.test(e.message);

function shapes(nodes: readonly SceneNode[]): ShapeNode[] {
  return nodes.flatMap((n) => (n.kind === "shape" ? [n] : n.kind === "group" || n.kind === "at" || n.kind === "clip" ? shapes(n.children) : []));
}

function record(draw: (v: View) => void): ShapeNode[] {
  return shapes(new SceneRecorder({ width: 100, height: 80 }).record(draw).scene.children);
}

test("a brushed stroke takes the style's blend when set, else the brush's (R1, decision 8)", () => {
  const line = (v: View, blend?: "normal" | "screen"): void => v.line(0, 0, 10, 0, { stroke: "#000", brush: "marker", ...(blend === undefined ? {} : { blend }) });
  const [plain, normal, screen] = record((v) => {
    line(v);
    line(v, "normal");
    line(v, "screen");
  });
  assert.deepEqual([plain?.style.brush?.blend, normal?.style.brush?.blend, screen?.style.brush?.blend], ["multiply", "normal", "screen"]);
  assert.equal(normal?.style.brush?.own, "multiply", "inside a shape's effects layer the marker still multiplies (R2)");
  const [pencil] = record((v) => v.line(0, 0, 10, 0, { stroke: "#000", brush: { preset: "pencil", grain: 0.2 }, gesture: { pressure: "swell", seed: 4 } }));
  assert.equal(pencil?.style.brush?.brush.grain, 0.2);
  assert.deepEqual(pencil?.style.brush?.gesture, { pressure: "swell", seed: 4 });
});

test("smudge and wet: no effects (R2), no blend or erase; wet needs a solid colour; gestures are checked", () => {
  const smudge = { stroke: "#000", brush: "smudge" } as const;
  assert.throws(() => record((v) => v.line(0, 0, 1, 1, { ...smudge, effects: { blur: 1 } })), usage(/a smudge brush with effects has nothing to read \(R2\)/));
  assert.throws(() => record((v) => v.line(0, 0, 1, 1, { ...smudge, erase: true })), usage(/a smudge brush cannot erase or blend/));
  assert.throws(() => record((v) => v.line(0, 0, 1, 1, { stroke: v.linearGradient(0, 0, 1, 0, [[0, "#000"], [1, "#fff"]]), brush: "wet" })), usage(/a wet brush needs a solid stroke colour/));
  assert.throws(() => record((v) => v.line(0, 0, 1, 1, { stroke: "#000", brush: "ink", gesture: { wobble: -1 } })), usage(/gesture wobble must be a finite number ≥ 0/));
  // @ts-expect-error -- not a preset; the runtime must refuse it
  assert.throws(() => record((v) => v.line(0, 0, 1, 1, { stroke: "#000", brush: "nib" })), usage(/unknown brush "nib"/));
});

test("a brushed stroke cannot be dashed: the error says to draw each dash as its own line or curve; bad dash lists are refused as today", () => {
  const rec = new SceneRecorder({ width: 40, height: 40 });
  assert.throws(() => rec.record((v) => v.line(0, 0, 30, 30, { stroke: "#000", brush: "pencil", dash: [4, 2] })), usage(/line: style\.dash works on plain strokes; a brushed stroke cannot be dashed, so draw each dash as its own line or curve with the brush/));
  assert.throws(() => rec.record((v) => v.line(0, 0, 30, 30, { stroke: "#000", dash: [0, 0] })), usage(/style\.dash must be lengths ≥ 0, at least one over 0/));
  const scene = rec.record((v) => v.line(0, 0, 30, 30, { stroke: "#000", dash: [4, 2] })).scene;
  assert.deepEqual(shapes(scene.children)[0]?.style.dash, [4, 2]);
});

test("paper lasts to the end of its group, picture or scene; at and clip do not end it (R9)", () => {
  const line = (v: View): void => v.line(0, 0, 1, 0, { stroke: "#000", brush: "pencil" });
  const seeds = record((v) => {
    line(v);
    v.group({}, () => {
      v.paper({ seed: 2 });
      line(v);
    });
    line(v);
    v.at({ translate: [1, 1] }, () => v.paper({ seed: 3 }));
    line(v);
  }).map((s) => s.style.brush?.paper.seed);
  assert.deepEqual(seeds, [1, 2, 1, 3]);
  // @ts-expect-error -- not a paper field; the runtime must refuse it
  assert.throws(() => record((v) => v.paper({ grit: 1 })), usage(/paper has no "grit"/));
  assert.throws(() => record((v) => v.paper({ contrast: 2 })), usage(/paper contrast must be a number in 0..1/));
});

test("a picture's paper is part of its version (R9)", () => {
  const rec = new SceneRecorder({ width: 10, height: 10 });
  let runs = 0;
  const ask = (seed: number) => (v: View): void => {
    v.paper({ seed });
    v.picture({ key: "k", width: 1, height: 1 }, () => void runs++);
  };
  rec.record(ask(1));
  rec.record(ask(1));
  rec.record(ask(2));
  assert.equal(runs, 2);
});

let text: TextMeasurer | undefined;
before(async () => {
  text = await openTextMeasurer();
});

test("text is measured at the call with today's numbers, inside a picture against the picture's box", (t) => {
  if (text === undefined) return t.skip("no text measurer");
  const rec = new SceneRecorder({ width: 200, height: 100 }, { text });
  const cases: [string, { x: number; y: number; w?: number }, { size?: number; align?: "center"; keepInside?: boolean }][] = [
    ["Hello", { x: 10, y: 10 }, {}],
    ["Two words wrap", { x: 10, y: 40, w: 50 }, { size: 14 }],
    ["Off the edge", { x: 195, y: 50 }, { keepInside: true }],
  ];
  const got: unknown[] = [];
  let width = 0;
  let inside: { x: number } = { x: 0 };
  const scene = rec.record((v) => {
    for (const [s, box, o] of cases) got.push(v.text(s, box, o));
    width = v.textWidth("Hello", { size: 20 });
    v.picture({ key: "label", width: 60, height: 20 }, () => {
      inside = v.textBounds("Off the edge", { x: 55, y: 0 }, { keepInside: true });
    });
  }).scene;
  // The Skia painter's numbers for the same calls, recorded before it was deleted.
  assert.deepEqual(got, [
    { x: 10, y: 10, w: 27.345703125, h: 15, lines: 1, size: 12, overflow: false },
    { x: 10, y: 40, w: 37.3447265625, h: 52.5, lines: 3, size: 14, overflow: false },
    { x: 130.169921875, y: 50, w: 65.830078125, h: 15, lines: 1, size: 12, overflow: false },
  ]);
  assert.equal(width, 45.576171875);
  assert.ok(inside.x < 55 - 20, `keepInside keeps the text inside the picture's 60 px box (x ${inside.x})`);
  const node = scene.children[1];
  assert.ok(node?.kind === "text");
  assert.deepEqual(node.lines.map((l) => l.glyphs.join("")), ["Two", "words", "wrap"]);
  assert.equal(node.lines[0]?.xs[0], 10);
  assert.throws(() => new SceneRecorder({ width: 10, height: 10 }).record((v) => v.text("x", { x: 0, y: 0 })), (e: unknown) => e instanceof UnsupportedCallError && e.call === "v.text");
});

// Rows and columns (plan:canvas-loop-layout-text-hits.subplan, chunk A2):
// `v.row` and `v.column` place each child by its layout box, `gap` apart, and
// return one `at` node holding a translating `at` per child. Each test reads
// where every child landed from the recorded scene.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { SketchUsageError } from "../../src/core/errors.js";
import type { Bounds, Drawing, View } from "../../src/core/tea.js";
import type { TextMeasurer } from "../../src/core/text/measure.js";
import { openTextMeasurer } from "../../src/device/open.js";
import type { SceneNode } from "../../src/scene/nodes.js";
import { layoutBox } from "../../src/scene/layout-box.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";

let text: TextMeasurer | undefined;
before(async () => {
  text = await openTextMeasurer();
});

const INK = { fill: "#000" } as const;

/** The one node `draw` returns. */
function recorded(draw: (v: View) => Drawing): SceneNode {
  if (text === undefined) throw new Error("no text measurer");
  const { scene } = new SceneRecorder({ width: 300, height: 200 }, { text }).record(draw);
  const [node] = scene.children;
  assert.ok(node !== undefined && scene.children.length === 1, "one node");
  return node;
}

/** Each child of a flow's `at` node: its layout box where the flow put it (null for one that takes no place). */
function placed(draw: (v: View) => Drawing): (Bounds | null)[] {
  const flow = recorded(draw);
  assert.ok(flow.kind === "at", "a flow is an at node");
  return flow.children.map((c) => layoutBox([c]));
}

/** `[x, y, w, h]` of each box, rounded to 1e-6. */
const xywh = (boxes: readonly (Bounds | null)[]): (number[] | null)[] => boxes.map((b) => (b === null ? null : [b.x, b.y, b.w, b.h].map((n) => Math.round(n * 1e6) / 1e6)));

const bars = (v: View): Drawing => [v.rect(0, 0, 10, 10, INK), v.rect(0, 0, 10, 20, INK), v.rect(0, 0, 10, 30, INK)];

test("row: valign top, middle and bottom line each child up at y", () => {
  assert.deepEqual(xywh(placed((v) => v.row({ y: 50, gap: 5 }, bars(v)))), [[0, 50, 10, 10], [15, 50, 10, 20], [30, 50, 10, 30]]);
  assert.deepEqual(xywh(placed((v) => v.row({ y: 50, gap: 5, valign: "middle" }, bars(v)))), [[0, 45, 10, 10], [15, 40, 10, 20], [30, 35, 10, 30]]);
  assert.deepEqual(xywh(placed((v) => v.row({ y: 50, gap: 5, valign: "bottom" }, bars(v)))), [[0, 40, 10, 10], [15, 30, 10, 20], [30, 20, 10, 30]]);
});

test("row: align left, center and right place the whole row about x", () => {
  const lefts = (align: "left" | "center" | "right"): (number | undefined)[] => placed((v) => v.row({ x: 100, gap: 5, align }, bars(v))).map((b) => b?.x);
  assert.deepEqual(lefts("left"), [100, 115, 130]);
  assert.deepEqual(lefts("center"), [80, 95, 110]);
  assert.deepEqual(lefts("right"), [60, 75, 90]);
});

test("row: valign baseline puts each text's baseline on y, and a box with no baseline by its bottom", () => {
  const boxes = placed((v) => v.row({ y: 80, gap: 4, valign: "baseline" }, [
    v.text("Small", { x: 0, y: 0 }, { size: 12 }),
    v.text("Big", { x: 0, y: 0 }, { size: 32, valign: "middle" }),
    v.rect(0, 0, 8, 8, INK),
  ]));
  assert.equal(boxes[0]?.baseline, 80);
  assert.equal(boxes[1]?.baseline, 80);
  assert.equal(boxes[2]?.baseline, null);
  assert.equal((boxes[2]?.y ?? 0) + (boxes[2]?.h ?? 0), 80);
});

test("column: align lines each child up at x; valign places the whole column about y", () => {
  const wide = (v: View): Drawing => [v.rect(0, 0, 10, 10, INK), v.rect(0, 0, 30, 10, INK)];
  assert.deepEqual(xywh(placed((v) => v.column({ x: 50, y: 0, gap: 2 }, wide(v)))), [[50, 0, 10, 10], [50, 12, 30, 10]]);
  assert.deepEqual(xywh(placed((v) => v.column({ x: 50, gap: 2, align: "center" }, wide(v)))), [[45, 0, 10, 10], [35, 12, 30, 10]]);
  assert.deepEqual(xywh(placed((v) => v.column({ x: 50, gap: 2, align: "right" }, wide(v)))), [[40, 0, 10, 10], [20, 12, 30, 10]]);
  assert.deepEqual(xywh(placed((v) => v.column({ y: 100, gap: 2, valign: "middle" }, wide(v)))), [[0, 89, 10, 10], [0, 101, 30, 10]]);
  assert.deepEqual(xywh(placed((v) => v.column({ y: 100, gap: 2, valign: "bottom" }, wide(v)))), [[0, 78, 10, 10], [0, 90, 30, 10]]);
});

test("a child drawn away from its origin lands where one at its origin does", () => {
  assert.deepEqual(xywh(placed((v) => v.row({ x: 10, y: 10 }, [v.rect(240, 80, 10, 10, INK), v.rect(0, 0, 10, 10, INK)]))), [[10, 10, 10, 10], [20, 10, 10, 10]]);
});

test("children that draw nothing a layout can place take no room and no gap, and stay in the drawing", () => {
  const flow = recorded((v) => v.row({ gap: 5 }, [v.rect(0, 0, 10, 10, INK), null, v.light({ kind: "point", at: [0, 0] }), v.at({}, []), v.rect(0, 0, 10, 10, INK)]));
  assert.ok(flow.kind === "at");
  assert.deepEqual(flow.children.map((c) => c.kind), ["at", "light", "at", "at"]);
  assert.deepEqual(xywh(flow.children.map((c) => layoutBox([c]))), [[0, 0, 10, 10], null, null, [15, 0, 10, 10]]);
});

test("nested: a row in a row is one item, and a column's baseline is its first child's", () => {
  assert.deepEqual(xywh(placed((v) => v.row({ gap: 10 }, [v.row({ gap: 1 }, bars(v)), v.rect(0, 0, 5, 5, INK)]))), [[0, 0, 32, 30], [42, 0, 5, 5]]);
  const boxes = placed((v) => v.row({ y: 60, valign: "baseline" }, [
    v.text("a", { x: 0, y: 0 }, { size: 14 }),
    v.column({ gap: 3 }, [v.text("top", { x: 0, y: 0 }, { size: 20 }), v.text("under", { x: 0, y: 0 }, { size: 20 })]),
  ]));
  assert.equal(boxes[0]?.baseline, 60);
  assert.equal(boxes[1]?.baseline, 60, "the column's first text sits on the row's baseline");
});

test("a component that returns two shapes is two items, or one when wrapped in v.at({}, …)", () => {
  const arrow = (v: View): Drawing => [v.line(0, 0, 30, 0, { stroke: "#000", weight: 2 }), v.polygon([[30, -4], [36, 0], [30, 4]], INK)];
  assert.equal(placed((v) => v.row({ gap: 10 }, [v.rect(0, 0, 5, 5, INK), arrow(v)])).length, 3, "unwrapped, the line and the head are two items with a gap between");
  const wrapped = placed((v) => v.row({ gap: 10 }, [v.rect(0, 0, 5, 5, INK), v.at({}, arrow(v))]));
  assert.deepEqual(xywh(wrapped), [[0, 0, 5, 5], [15, 0, 37, 8]], "the line's box starts half its weight left of 0");
});

test("flow options: unknown keys, bad numbers and alignments are refused naming the call and key", () => {
  const usage = (re: RegExp) => (e: unknown): boolean => e instanceof SketchUsageError && re.test(e.message);
  // Options as a sketch can pass them through a variable, past the types.
  const flow = (call: "row" | "column", options: object) => (v: View): Drawing => {
    Reflect.apply(v[call], v, [options, []]);
    return null;
  };
  const bad: [(v: View) => Drawing, RegExp][] = [
    [flow("row", { hit: true }), /row: unknown option "hit" \(x, y, gap, align, valign, name\); there is no hit flag: every name is a target/],
    [flow("column", { gap: Number.NaN }), /column: option gap must be a finite number/],
    [flow("row", { align: "middle" }), /row: option align must be left, center, right/],
    [flow("column", { valign: "baseline" }), /column: option valign must be top, middle, bottom .*baseline is its first child's/],
  ];
  for (const [draw, re] of bad) assert.throws(() => recorded(draw), usage(re));
});

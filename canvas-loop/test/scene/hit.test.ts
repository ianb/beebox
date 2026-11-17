// The hit walk (plan:canvas-loop-layout-text-hits.subplan, chunk B1) on
// recorded scenes: topmost first, unnamed drawings never block, names nest
// innermost first, and each hit area is what the renderer draws (fills by
// nonzero winding, plain strokes by their stroke rings, brushed strokes by a
// weight / 2 band). No box rejection: a hit area outside any declared or
// estimated box is still found.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { Drawing, View } from "../../src/core/tea.js";
import type { TextMeasurer } from "../../src/core/text/measure.js";
import { openTextMeasurer } from "../../src/device/open.js";
import { hitTest } from "../../src/scene/hit.js";
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

/** The targets at each point, as one list per point. */
function targetsAt(s: Scene, points: readonly (readonly [number, number])[]): string[][] {
  return points.map((p) => {
    const hit = hitTest(s, p);
    assert.equal(hit.target, hit.targets[0], "target is the first of targets");
    return [...hit.targets];
  });
}

const FILL = { fill: "#888" } as const;

test("the topmost of two overlapping named circles wins; outside both, nothing", () => {
  const s = scene((v) => [v.circle(100, 100, 30, { ...FILL, name: "under" }), v.circle(120, 100, 30, { ...FILL, name: "over" })]);
  assert.deepEqual(targetsAt(s, [[110, 100], [75, 100], [145, 100], [10, 10]]), [["over"], ["under"], ["over"], []]);
});

test("an unnamed label drawn over a named pan does not block it", () => {
  const s = scene((v) => [v.rect(50, 50, 100, 40, { ...FILL, name: "pan" }), v.rect(60, 60, 80, 20, { fill: "#fff" }), v.text("Left", { x: 100, y: 70 }, { align: "center", valign: "middle" })]);
  assert.deepEqual(targetsAt(s, [[100, 70]]), [["pan"]]);
});

test("targets: a named shape inside a named at, innermost first; the at's own hit areas are its children's", () => {
  const s = scene((v) => v.at({ translate: [100, 100], name: "pan" }, [v.rect(-50, 0, 100, 10, FILL), v.circle(0, -10, 8, { ...FILL, name: "weight-7" })]));
  assert.deepEqual(targetsAt(s, [[100, 90], [60, 105], [100, 50]]), [["weight-7", "pan"], ["pan"], []]);
});

test("a ring: a stroke-only circle misses in its hole and hits with a transparent fill", () => {
  const ring = scene((v) => v.circle(100, 100, 40, { stroke: "#000", weight: 4, name: "ring" }));
  assert.deepEqual(targetsAt(ring, [[100, 100], [141, 100], [137, 100], [143, 100]]), [[], ["ring"], [], []]);
  const pad = scene((v) => v.circle(100, 100, 40, { fill: "transparent", stroke: "#000", weight: 4, name: "ring" }));
  assert.deepEqual(targetsAt(pad, [[100, 100]]), [["ring"]]);
});

test("a plain stroke: a band of weight / 2, its caps as drawn, and nothing in a dash gap", () => {
  const line = (style: object) => scene((v) => v.line(50, 100, 150, 100, { stroke: "#000", weight: 10, ...style, name: "l" }));
  assert.deepEqual(targetsAt(line({}), [[100, 104.9], [100, 95.1], [100, 105.5], [48, 100]]), [["l"], ["l"], [], []], "butt caps end at the points");
  assert.deepEqual(targetsAt(line({ cap: "round" }), [[46, 100], [44, 100]]), [["l"], []]);
  assert.deepEqual(targetsAt(line({ dash: [10, 10] }), [[55, 100], [65, 100], [75, 100]]), [["l"], [], ["l"]]);
});

test("a brushed stroke: a band of weight / 2 either side of its path", () => {
  const s = scene((v) => v.line(50, 100, 150, 100, { stroke: "#000", weight: 10, brush: "ink", name: "b" }));
  assert.deepEqual(targetsAt(s, [[100, 104.9], [100, 105.5], [100, 100]]), [["b"], [], ["b"]]);
  // Under scale [4, 1] the renderer draws the tip round, 10 × √4 = 20 across: 8 below the path on the canvas is inside.
  const wide = scene((v) => v.at({ scale: [4, 1] }, v.line(10, 50, 60, 50, { stroke: "#000", weight: 10, brush: "ink", name: "w" })));
  assert.deepEqual(targetsAt(wide, [[100, 58], [100, 61]]), [["w"], []]);
});

test("fills use nonzero winding: the middle of a five-point star is inside", () => {
  const star = [0, 1, 2, 3, 4].map((i): [number, number] => {
    const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    return [100 + 50 * Math.cos(a), 100 + 50 * Math.sin(a)];
  });
  assert.deepEqual(targetsAt(scene((v) => v.polygon(star, { ...FILL, name: "star" })), [[100, 100], [100, 52], [10, 10]]), [["star"], ["star"], []]);
});

test("clips cut hit areas: a clip scope and a group's clip option", () => {
  const box: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const clipped = scene((v) => v.clip(box, v.rect(0, 0, 300, 200, { ...FILL, name: "big" })));
  assert.deepEqual(targetsAt(clipped, [[50, 50], [150, 50]]), [["big"], []]);
  const grouped = scene((v) => v.group({ name: "g", clip: box }, v.rect(0, 0, 300, 200, FILL)));
  assert.deepEqual(targetsAt(grouped, [[50, 50], [150, 50]]), [["g"], []]);
});

test("a rotated at: the point is tested in the shape's own coordinates", () => {
  // A 100 × 10 bar about its centre, turned a quarter: it now runs down from y 50 to 150.
  const s = scene((v) => v.at({ translate: [100, 100], rotate: Math.PI / 2 }, v.rect(-50, -5, 100, 10, { ...FILL, name: "bar" })));
  assert.deepEqual(targetsAt(s, [[100, 140], [140, 100]]), [["bar"], []]);
});

test("a name inside a picture placed twice returns the placement it is in", () => {
  const s = scene((v) => {
    const knob = v.picture({ key: "knob", width: 20, height: 20 }, () => v.circle(10, 10, 8, { ...FILL, name: "knob" }));
    return [v.place(knob, 20, 20, { name: "slot-a" }), v.place(knob, 120, 20, { name: "slot-b" })];
  });
  assert.deepEqual(targetsAt(s, [[30, 30], [130, 30], [80, 30]]), [["knob", "slot-a"], ["knob", "slot-b"], []]);
});

test("a non-invertible at hits nothing", () => {
  const s = scene((v) => v.at({ scale: 0, name: "flat" }, v.rect(-500, -500, 1000, 1000, { ...FILL, name: "r" })));
  assert.deepEqual(targetsAt(s, [[0, 0], [100, 100]]), [[], []]);
});

test("erase shapes and mask artwork are not hit areas", () => {
  const erased = scene((v) => [v.rect(0, 0, 100, 100, { ...FILL, name: "under" }), v.rect(0, 0, 100, 100, { ...FILL, erase: true, name: "rubber" })]);
  assert.deepEqual(targetsAt(erased, [[50, 50]]), [["under"]]);
  const masked = scene((v) => v.mask(v.rect(0, 0, 300, 200, { ...FILL, name: "art" }), v.rect(0, 0, 100, 100, { ...FILL, name: "body" })));
  assert.deepEqual(targetsAt(masked, [[50, 50], [150, 50]]), [["body"], []]);
});

test("text by its box, a background by the canvas, a pixels placement by its box", () => {
  const s = scene((v) => {
    const dots = v.pixels({ key: "dots", width: 10, height: 10 }, () => {});
    return [v.at({ name: "ground" }, v.background("#eee")), v.text("Reset", { x: 20, y: 20 }, { size: 20, name: "reset" }), v.place(dots, 200, 100, { name: "dots" })];
  });
  assert.deepEqual(targetsAt(s, [[25, 30], [205, 105], [250, 150], [-5, 10]]), [["reset"], ["dots"], ["ground"], []]);
});

test("no box rejection: a picture body outside its box, a background under at in a picture, a tall text line box", () => {
  const outside = scene((v) => v.place(v.picture({ key: "spill", width: 20, height: 20 }, () => v.circle(60, 60, 5, { ...FILL, name: "spill" })), 100, 100));
  assert.deepEqual(targetsAt(outside, [[160, 160]]), [["spill"]]);
  // The renderer fills a body's background over the picture's box, whatever `at` it is under.
  const ground = scene((v) => v.place(v.picture({ key: "card", width: 50, height: 50 }, () => v.at({ translate: [200, 100], name: "card-ground" }, v.background("#eee"))), 10, 10));
  assert.deepEqual(targetsAt(ground, [[30, 30], [215, 115]]), [["card-ground"], []]);
  let mid: [number, number] = [0, 0];
  const tall = scene((v) => {
    const t = v.text("one two", { x: 10, y: 10, w: 30 }, { size: 10, lineHeight: 4, name: "tall" });
    const b = v.bounds(t);
    if (b !== null) mid = [b.x + b.w / 2, b.y + b.h / 2];
    return t;
  });
  assert.ok(mid[1] > 30, `the line box reaches well below the first line: ${mid[1]}`);
  assert.deepEqual(targetsAt(tall, [mid]), [["tall"]]);
});

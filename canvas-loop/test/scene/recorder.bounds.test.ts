// Layout boxes (plan:canvas-loop-layout-text-hits.subplan, chunk A1): `v.bounds`
// measures any drawing in the coordinates where it is returned. Text is its
// `textBounds` rectangle with its first baseline; a shape is its geometry plus
// half its stroke; a placement is its declared box. Measuring does not count
// as returning, and a node from an earlier frame is refused.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { SketchUsageError } from "../../src/core/errors.js";
import type { Bounds, DrawingNode, TextOptions, View } from "../../src/core/tea.js";
import type { TextMeasurer } from "../../src/core/text/measure.js";
import { openTextMeasurer } from "../../src/device/open.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";

let text: TextMeasurer | undefined;
before(async () => {
  text = await openTextMeasurer();
});

function recorder(audit?: boolean): SceneRecorder {
  if (text === undefined) throw new Error("no text measurer");
  return new SceneRecorder({ width: 300, height: 200 }, { text, audit: audit === true });
}

/** What `measure` returns inside one `draw`. */
function measured<T>(measure: (v: View) => T): T {
  let got: T | undefined;
  recorder().record((v) => {
    got = measure(v);
    return null;
  });
  if (got === undefined) throw new Error("draw did not run");
  return got;
}

function near(got: Bounds | null, want: { x: number; y: number; w: number; h: number; tol?: number }): void {
  assert.ok(got !== null, "a box");
  const t = want.tol ?? 1e-9;
  for (const k of ["x", "y", "w", "h"] as const) assert.ok(Math.abs(got[k] - want[k]) <= t, `${k}: got ${got[k]}, want ${want[k]} (${JSON.stringify(got)})`);
}

const STROKE = { stroke: "#000", weight: 4 } as const;

test("text: v.bounds is textBounds' rectangle, for one line, a wrapped box and fit", () => {
  const cases: [string, { x: number; y: number; w?: number; h?: number }, TextOptions][] = [
    ["Hello", { x: 40, y: 30 }, { size: 18, align: "center", valign: "middle" }],
    ["one two three four five", { x: 10, y: 10, w: 60 }, { size: 14 }],
    ["a long label that must shrink", { x: 10, y: 10, w: 80, h: 20 }, { size: 20, fit: true }],
  ];
  for (const [s, box, o] of cases) {
    const [b, t] = measured((v) => [v.bounds(v.text(s, box, o)), v.textBounds(s, box, o)] as const);
    near(b, t);
  }
});

test("text baseline: on y with valign baseline, below the top otherwise", () => {
  const [onY, top] = measured((v) => [v.bounds(v.text("Hg", { x: 0, y: 50 }, { size: 24, valign: "baseline" })), v.bounds(v.text("Hg", { x: 0, y: 50 }, { size: 24 }))]);
  assert.equal(onY?.baseline, 50);
  const b = top?.baseline ?? Number.NaN;
  assert.ok(b > 50 + 12 && b < 50 + 24, `a 24px baseline below the top at 50: ${b}`);
  const boxed = measured((v) => v.bounds(v.text("one two three", { x: 0, y: 0, w: 40 }, { size: 12, valign: "baseline" })));
  assert.equal(boxed?.baseline, 0, "boxed text on the baseline puts the first line's baseline on y");
});

test("a stroked rect grows by half its weight; a fill-only one does not", () => {
  const [stroked, filled] = measured((v) => [v.bounds(v.rect(10, 20, 30, 40, STROKE)), v.bounds(v.rect(10, 20, 30, 40, { fill: "#000" }))]);
  near(stroked, { x: 8, y: 18, w: 34, h: 44 });
  near(filled, { x: 10, y: 20, w: 30, h: 40 });
  assert.equal(filled?.baseline, null);
});

test("an ellipse under a rotated at is the box around the rotated box's corners, without a baseline", () => {
  const got = measured((v) => v.bounds(v.at({ translate: [100, 100], rotate: Math.PI / 4 }, v.ellipse(0, 0, 20, 10, { fill: "#000" }))));
  const half = (30 * Math.SQRT2) / 2;
  near(got, { x: 100 - half, y: 100 - half, w: 2 * half, h: 2 * half });
  assert.equal(got?.baseline, null);
  const turned = measured((v) => v.bounds(v.at({ rotate: 0.3 }, v.text("A", { x: 0, y: 0 }))));
  assert.equal(turned?.baseline, null, "a rotation drops the baseline");
  const moved = measured((v) => [v.bounds(v.text("A", { x: 0, y: 0 })), v.bounds(v.at({ translate: [5, 7], scale: 2 }, v.text("A", { x: 0, y: 0 })))] as const);
  assert.equal(moved[1]?.baseline, 7 + 2 * (moved[0]?.baseline ?? Number.NaN), "a translate and scale move the baseline");
});

test("a path with a bezier is bounded by its curve, not its control points", () => {
  const got = measured((v) => v.bounds(v.path([["move", 0, 0], ["bezier", 0, 100, 100, 100, 100, 0]], { fill: "#000" })));
  // The curve peaks at y = 75 (3/4 of the control height) at t = 0.5.
  near(got, { x: 0, y: 0, w: 100, h: 75, tol: 0.1 });
});

test("a place is its picture's declared box; a background, a light and an erase shape add nothing", () => {
  const got = measured((v) => {
    const pic = v.picture({ key: "p", width: 30, height: 20 }, () => v.rect(-50, -50, 500, 500, { fill: "#000" }));
    return [v.bounds(v.place(pic, 5, 6)), v.bounds([v.background("#fff"), v.light({ kind: "point", at: [0, 0] }), v.rect(0, 0, 9, 9, { fill: "#000", erase: true })])];
  });
  near(got[0] ?? null, { x: 5, y: 6, w: 30, h: 20 });
  assert.equal(got[1], null);
});

test("a clip cuts its children's box; a list is the union; nothing is null", () => {
  const [clipped, both, empty, none] = measured((v) => [
    v.bounds(v.clip([[0, 0], [10, 0], [10, 10], [0, 10]], v.rect(5, 5, 20, 20, { fill: "#000" }))),
    v.bounds([v.rect(0, 0, 10, 10, { fill: "#000" }), v.text("x", { x: 20, y: 0 }, { valign: "baseline" })]),
    v.bounds([]),
    v.bounds([null, false, undefined]),
  ]);
  near(clipped, { x: 5, y: 5, w: 5, h: 5 });
  assert.equal(both?.x, 0);
  assert.equal(both?.baseline, 0, "the list's baseline is its first text's");
  assert.equal(empty, null);
  assert.equal(none, null);
});

test("v.bounds does not count as returning: testing mode still warns of a node only measured", () => {
  const { warnings } = recorder(true).record((v) => {
    v.bounds(v.rect(0, 0, 5, 5, { fill: "#000" }));
    return null;
  });
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0]?.startsWith("v.rect made a drawing that was not returned"), warnings[0]);
  const measuredThenReturned = recorder(true).record((v) => {
    const r = v.rect(0, 0, 5, 5, { fill: "#000" });
    v.bounds(r);
    return r;
  });
  assert.deepEqual(measuredThenReturned.warnings, []);
});

test("a node made in an earlier frame is refused, naming bounds", () => {
  const rec = recorder();
  let kept: DrawingNode | undefined;
  rec.record((v) => {
    kept = v.rect(0, 0, 1, 1, { fill: "#000" });
    return kept;
  });
  assert.throws(() => rec.record((v) => (v.bounds(kept ?? null), null)), (e: unknown) => e instanceof SketchUsageError && /bounds: this drawing was made in an earlier frame/.test(e.message));
});

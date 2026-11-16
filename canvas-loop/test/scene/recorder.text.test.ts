// Text measuring in the scene recorder, ported from the Canvas2D painter's
// tests when it was deleted (scene core chunk 6): `textBounds` answers what
// `text` would draw without drawing, a halo widens the bounds by its band, and
// `keepInside` slides a label back inside the canvas, under a transform too.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { TextBounds } from "../../src/core/paint.js";
import type { TextMeasurer } from "../../src/core/text/measure.js";
import { openTextMeasurer } from "../../src/device/open.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";

let text: TextMeasurer | undefined;
before(async () => {
  text = await openTextMeasurer();
});

function recorder(size: { width: number; height: number }): SceneRecorder {
  if (text === undefined) throw new Error("no text measurer");
  return new SceneRecorder(size, { text });
}

test("textBounds returns what text would and draws nothing", () => {
  const options = { size: 14, align: "center", valign: "middle" } as const;
  const wrapped = { x: 5, y: 5, w: 50 };
  const got: TextBounds[] = [];
  const measuring = recorder({ width: 120, height: 60 }).record((v) => {
    got.push(v.textBounds("Hello there", { x: 60, y: 30 }, options), v.textBounds("one two three four", wrapped));
    return null;
  });
  assert.deepEqual(measuring.scene.children, [], "nothing drawn");
  const drawn = recorder({ width: 120, height: 60 }).record((v) => [v.text("Hello there", { x: 60, y: 30 }, options), v.text("one two three four", wrapped)]).scene.children;
  // The drawn lines start where the measured bounds do.
  const lefts = drawn.map((n) => (n.kind === "text" ? n.lines[0]?.xs[0] : undefined));
  const [hello, wrap] = got;
  assert.ok(Math.abs((lefts[0] ?? Number.NaN) - (hello?.x ?? Number.NaN)) < 0.01 && lefts[1] === wrap?.x, `lefts ${lefts.join(",")}`);
});

test("a halo widens the bounds by its band on every side", () => {
  recorder({ width: 400, height: 200 }).record((v) => {
    const plain = v.textBounds("H", { x: 40, y: 40 }, { size: 80 });
    const haloed = v.textBounds("H", { x: 40, y: 40 }, { size: 80, halo: "#fff" });
    assert.deepEqual([haloed.x, haloed.y, haloed.w], [plain.x - 10, plain.y - 10, plain.w + 20]);
    return null;
  });
});

test("keepInside slides a centred label back inside the canvas; textBounds measures where no transform moves it", () => {
  recorder({ width: 200, height: 100 }).record((v) => {
    const options = { size: 16, align: "center", valign: "middle", keepInside: true } as const;
    const plain = v.textBounds("Hydrogen · 1.008 u", { x: 10, y: 50 }, { ...options, keepInside: false });
    assert.ok(plain.x < 0, "the plain label crosses the left edge");
    const kept = v.textBounds("Hydrogen · 1.008 u", { x: 10, y: 50 }, options);
    assert.ok(Math.abs(kept.x - 4) < 0.01, `left edge at the margin: ${kept.x}`);
    assert.deepEqual(v.textBounds("Mid", { x: 100, y: 50 }, options), v.textBounds("Mid", { x: 100, y: 50 }, { ...options, keepInside: false }));
    const right = v.textBounds("Label", { x: 190, y: 25 }, { ...options, align: "left" });
    assert.ok(Math.abs(right.x + right.w - 196) < 0.01, `right edge at the margin: ${right.x + right.w}`);
    return null;
  });
});

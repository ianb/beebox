import assert from "node:assert/strict";
import { test } from "node:test";
import { Sketch } from "../../src/headless/sketch.js";
import { TeaView } from "../../src/headless/tea-view.js";
import { toTeaModule } from "../../src/headless/tea-load.js";
import { controlModels } from "../../src/browser/controls-model.js";

function makeSketch(): Sketch {
  const s = new Sketch({ host: { recordLog(): void {}, requestSnapshot(): void {} }, seed: 1, fps: 60, onHandled: () => {} });
  s.createCanvas(100, 60);
  return s;
}

const alpha = (s: Sketch, at: readonly [number, number]): number => s.readPixels().data[(at[1] * 100 + at[0]) * 4 + 3] ?? 0;

test("textWidth grows with the text and the text size", () => {
  const s = makeSketch();
  s.textSize(12);
  const short = s.textWidth("H");
  const long = s.textWidth("HHHH");
  s.textSize(24);
  assert.ok(short > 0 && long > short * 3, `${short} vs ${long}`);
  assert.ok(s.textWidth("HHHH") > long * 1.8);
});

test("rect with a radius rounds its corners", () => {
  const s = makeSketch();
  s.noStroke();
  s.fill("#000000");
  s.rect(10, 10, 80, 40, 15);
  assert.equal(alpha(s, [11, 11]), 0, "the corner is cut");
  assert.equal(alpha(s, [50, 30]), 255);
  assert.equal(alpha(s, [11, 30]), 255, "the straight side is full");
});

test("a param's label and hint survive loading and reach its control", () => {
  const loaded = toTeaModule({
    params: { a: { type: "number", min: 1, max: 12, default: 1, step: 1, control: "field", label: "box A", hint: "first species" } },
    init: () => ({}),
    update: (m: unknown) => m,
    draw: () => {},
  });
  const [model] = controlModels({ decl: loaded.params ?? {}, values: {} });
  assert.deepEqual([model?.name, model?.label, model?.hint], ["a", "box A", "first species"]);
});

test("box text uses per-call style without changing the current settings", () => {
  const s = makeSketch();
  s.textSize(12);
  const before = s.textWidth("H");
  s.noFill();
  const bounds = s.text("Hi", { x: 50, y: 30 }, { align: "center", valign: "middle", size: 20, fill: "#000000" });
  assert.equal(bounds.size, 20);
  assert.ok(alpha(s, [Math.round(bounds.x + bounds.w / 4), 30]) > 0 || alpha(s, [Math.round(bounds.x + 2), 30]) > 0, "the text drew in the per-call fill");
  assert.equal(s.textWidth("H"), before, "the text size is still 12");
  const none = makeSketch();
  none.noFill();
  none.text("Hi", 50, 30);
  assert.equal(none.readPixels().data.some((v) => v !== 0), false, "point text still follows noFill");
});

test("control draws a stand-in with the param's value headless, and rejects an undeclared name", () => {
  const s = makeSketch();
  const v = new TeaView({ sketch: s, decl: { n: { type: "number", min: 1, max: 9, default: 7 } }, getParams: () => ({ n: 7 }) });
  v.control("n", { x: 10, y: 10, w: 40, h: 24 });
  assert.equal(alpha(s, [30, 11]), 255, "the stand-in's frame is drawn");
  assert.throws(() => v.control("missing", { x: 0, y: 0, w: 10 }), /no param named "missing"/u);
});

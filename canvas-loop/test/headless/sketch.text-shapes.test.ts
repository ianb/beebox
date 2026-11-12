import assert from "node:assert/strict";
import { test } from "node:test";
import { Sketch } from "../../src/headless/sketch.js";
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

import assert from "node:assert/strict";
import { test } from "node:test";
import { toTeaModule } from "../../src/headless/tea-load.js";
import { controlModels } from "../../src/browser/controls-model.js";
import { teaView } from "../helpers.js";

test("textWidth grows with the text and the text size", () => {
  const { v } = teaView({ width: 100, height: 60 });
  const short = v.textWidth("H", { size: 12 });
  const long = v.textWidth("HHHH", { size: 12 });
  assert.ok(short > 0 && long > short * 3, `${short} vs ${long}`);
  assert.ok(v.textWidth("HHHH", { size: 24 }) > long * 1.8);
});

test("roundRect rounds its corners", () => {
  const { v, alpha } = teaView({ width: 100, height: 60 });
  v.roundRect(10, 10, 80, 40, 15, { fill: "#000000" });
  assert.equal(alpha(11, 11), 0, "the corner is cut");
  assert.equal(alpha(50, 30), 255);
  assert.equal(alpha(11, 30), 255, "the straight side is full");
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

test("text takes its size, alignment and fill from its own options", () => {
  const { v, alpha } = teaView({ width: 100, height: 60 });
  const bounds = v.text("Hi", { x: 50, y: 30 }, { align: "center", valign: "middle", size: 20, fill: "#000000" });
  assert.equal(bounds.size, 20);
  assert.ok(alpha(Math.round(bounds.x + bounds.w / 4), 30) > 0 || alpha(Math.round(bounds.x + 2), 30) > 0, "the text drew in the per-call fill");
});

test("control draws a stand-in with the param's value headless, and rejects an undeclared name", () => {
  const { v, alpha } = teaView({ width: 100, height: 60 }, { decl: { n: { type: "number", min: 1, max: 9, default: 7 } }, values: { n: 7 } });
  v.control("n", { x: 10, y: 10, w: 40, h: 24 });
  assert.equal(alpha(30, 11), 255, "the stand-in's frame is drawn");
  assert.throws(() => v.control("missing", { x: 0, y: 0, w: 10 }), /no param named "missing"/u);
});

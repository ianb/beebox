import assert from "node:assert/strict";
import { test } from "node:test";
import { teaView } from "../helpers.js";

test("a dashed line leaves gaps; a brushed or malformed dash is an error", () => {
  const { v, alpha } = teaView({ width: 60, height: 20 });
  v.line(0, 10, 60, 10, { stroke: "#000", weight: 4, dash: [10, 10] });
  assert.ok(alpha(5, 10) > 200, "dash drawn");
  assert.equal(alpha(15, 10), 0, "gap left empty");
  // The dash ends with the call: the next stroke is solid.
  v.line(0, 16, 60, 16, { stroke: "#000", weight: 2 });
  assert.ok(alpha(15, 16) > 200);
  assert.throws(() => v.line(0, 0, 9, 9, { stroke: "#000", brush: "ink", dash: [4, 4] }), /line: style\.dash works on plain strokes/u);
  assert.throws(() => v.line(0, 0, 9, 9, { stroke: "#000", dash: [0, 0] }), /style\.dash must be lengths/u);
  assert.throws(() => v.line(0, 0, 9, 9, { stroke: "#000", dash: [-1, 4] }), /style\.dash must be lengths/u);
});

test("textBounds returns what text would and draws nothing", () => {
  const { v, pixels } = teaView({ width: 120, height: 60 });
  const options = { size: 14, align: "center", valign: "middle" } as const;
  const measured = v.textBounds("Hello there", { x: 60, y: 30 }, options);
  assert.ok(pixels().every((byte) => byte === 0), "nothing drawn");
  assert.deepEqual(v.text("Hello there", { x: 60, y: 30 }, options), measured);
  const wrapped = { x: 5, y: 5, w: 50 };
  assert.deepEqual(v.textBounds("one two three four", wrapped), v.text("one two three four", wrapped));
});

test("a halo paints a band of its color around the letters", () => {
  const { v, rgba } = teaView({ width: 80, height: 40 });
  v.background("#000");
  v.text("IIII", { x: 10, y: 20 }, { size: 24, fill: "#000", halo: "#ff0000", valign: "middle" });
  let red = 0;
  for (let x = 0; x < 80; x += 1) for (let y = 0; y < 40; y += 1) if ((rgba(x, y)[0] ?? 0) > 200) red += 1;
  assert.ok(red > 40, `halo pixels: ${red}`);
});

test("texts that overlap in a frame are reported once per pair", () => {
  const { v, logs, finishFrame } = teaView({ width: 200, height: 100 });
  for (let frame = 0; frame < 3; frame += 1) {
    v.text("Mass", { x: 20, y: 20 }, { size: 16 });
    v.text("Volume", { x: 30 + frame, y: 24 }, { size: 16 });
    // The same words twice (a shadow) and well-separated labels are fine.
    v.text("Shadow", { x: 20, y: 70 }, { size: 16, fill: "#888" });
    v.text("Shadow", { x: 21, y: 71 }, { size: 16 });
    v.text("Far", { x: 150, y: 70 }, { size: 16 });
    finishFrame();
  }
  const overlaps = logs.filter((line) => line.includes("overlaps"));
  assert.equal(overlaps.length, 1, logs.join("\n"));
  assert.match(overlaps[0] ?? "", /text "Mass" overlaps text "Volume"/u);
});

test("stacked lines and labels in a column do not count as overlapping", () => {
  const { v, logs, finishFrame } = teaView({ width: 200, height: 120 });
  for (const [i, label] of ["Hydrogen", "Helium", "Lithium", "Beryllium"].entries()) v.text(label, { x: 10, y: 10 + i * 15 }, { size: 12 });
  v.text("first line\nsecond line", { x: 100, y: 10, w: 90 });
  finishFrame();
  assert.deepEqual(logs, []);
});

test("overlap counts text under a transform and text inside a pasted cache", () => {
  const { v, logs, finishFrame } = teaView({ width: 200, height: 100 });
  const legend = (): void => void v.text("Legend", { x: 100, y: 50 }, { size: 16 });
  v.cache("legend", legend);
  finishFrame();
  // Frame 2: the cache is pasted, not redrawn; a label moved under `at` lands on it.
  v.cache("legend", legend);
  v.at({ translate: [90, 45] }, () => void v.text("Key", { x: 15, y: 6 }, { size: 16 }));
  finishFrame();
  assert.equal(logs.filter((line) => /"Legend" overlaps text "Key"/u.test(line)).length, 1, logs.join("\n"));
});

test("a character the font cannot draw is reported once", () => {
  const { v, logs } = teaView({ width: 100, height: 40 });
  v.text("CO₂ ₈", { x: 5, y: 5 });
  v.text("₈ again", { x: 5, y: 20 });
  v.text("plain ascii", { x: 5, y: 30 });
  const missing = logs.filter((line) => line.includes("has no glyph"));
  assert.ok(missing.some((line) => line.includes('"₈" (U+2088)')), logs.join("\n"));
  assert.equal(missing.filter((line) => line.includes("U+2088")).length, 1);
});

test("review fixes: halo bounds, a warning budget, erase pastes, and cached text past the frame cap", () => {
  const { v, logs, finishFrame } = teaView({ width: 400, height: 200 });
  const plain = v.textBounds("H", { x: 40, y: 40 }, { size: 80 });
  const haloed = v.textBounds("H", { x: 40, y: 40 }, { size: 80, halo: "#fff" });
  assert.deepEqual([haloed.x, haloed.y, haloed.w], [plain.x - 10, plain.y - 10, plain.w + 20]);
  // A label whose words change every frame warns at most ten times, then once more to say so.
  for (let frame = 0; frame < 30; frame += 1) {
    v.text(`value ${frame}`, { x: 10, y: 10 }, { size: 16 });
    v.text("Units", { x: 20, y: 12 }, { size: 16 });
    finishFrame();
  }
  assert.equal(logs.filter((line) => /^text[ :]/u.test(line)).length, 11, logs.join("\n"));
  assert.match(logs.at(-1) ?? "", /no more overlaps are reported/u);
});

test("an erasing cache paste adds no texts; a cache keeps its texts when the frame is full", () => {
  const { v, logs, finishFrame } = teaView({ width: 400, height: 200 });
  for (let i = 0; i < 2100; i += 1) v.text(`n${i}`, { x: (i % 40) * 10, y: 150 + Math.floor(i / 40) }, { size: 1 });
  v.cache("label", () => void v.text("Visible", { x: 100, y: 50 }, { size: 16 }));
  finishFrame();
  logs.length = 0;
  v.cache("label", () => {}, { erase: true });
  v.text("Other", { x: 105, y: 52 }, { size: 16 });
  finishFrame();
  assert.equal(logs.length, 0, logs.join("\n"));
  v.cache("label", () => {});
  v.text("Other", { x: 105, y: 52 }, { size: 16 });
  finishFrame();
  assert.equal(logs.filter((line) => line.includes('"Visible" overlaps text "Other"') || line.includes('"Other" overlaps text "Visible"')).length, 1, logs.join("\n"));
});

test("letters a font draws produce no glyph warning", () => {
  const { v, logs } = teaView({ width: 200, height: 40 });
  v.text("Hello ° → naïve", { x: 5, y: 5 });
  assert.deepEqual(logs.filter((line) => line.includes("has no glyph")), []);
});

test("keepInside slides a centred label back inside the canvas, also under a transform", () => {
  const { v } = teaView({ width: 200, height: 100 });
  const options = { size: 16, align: "center", valign: "middle", keepInside: true } as const;
  const plain = v.textBounds("Hydrogen · 1.008 u", { x: 10, y: 50 }, { ...options, keepInside: false });
  assert.ok(plain.x < 0, "the plain label crosses the left edge");
  const kept = v.textBounds("Hydrogen · 1.008 u", { x: 10, y: 50 }, options);
  assert.ok(Math.abs(kept.x - 4) < 0.01, `left edge at the margin: ${kept.x}`);
  assert.deepEqual(v.textBounds("Mid", { x: 100, y: 50 }, options), v.textBounds("Mid", { x: 100, y: 50 }, { ...options, keepInside: false }));
  v.at({ translate: [150, 0], scale: 2 }, () => {
    const right = v.textBounds("Label", { x: 20, y: 25 }, options);
    // In local units the right edge sits at (200 - 4 - 150) / 2.
    assert.ok(Math.abs(right.x + right.w - 23) < 0.01, `right edge: ${right.x + right.w}`);
  });
});

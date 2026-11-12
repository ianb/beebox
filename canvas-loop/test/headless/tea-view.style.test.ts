import assert from "node:assert/strict";
import { test } from "node:test";
import { teaView } from "../helpers.js";

test("an explicit style ignores the modal settings", () => {
  const { v, rgba } = teaView({ width: 40, height: 40 });
  v.fill("#ff0000");
  v.stroke("#00ff00");
  v.strokeWeight(9);
  v.brush("chalk");
  v.erase();
  v.rect(10, 10, 20, 20, { fill: "#0000ff" });
  assert.deepEqual(rgba(20, 20), [0, 0, 255, 255], "filled blue, not erased");
  assert.deepEqual(rgba(10, 10), [0, 0, 255, 255], "no stroke at the corner");
  assert.deepEqual(rgba(7, 7), [0, 0, 0, 0], "no 9px stroke outside");
});

test("a call that can draw nothing is logged once", () => {
  const { v, logs } = teaView({ width: 20, height: 20 });
  v.line(0, 0, 10, 10, { fill: "red" });
  v.line(0, 0, 10, 10, { fill: "red" });
  assert.deepEqual(logs.filter((line) => line.includes("line:")), ["line: a line has no inside, so its fill draws nothing; give the style a stroke"]);
});

test("at transforms its body only, and restores after a throw", () => {
  const { v, rgba } = teaView({ width: 40, height: 40 });
  const red = { fill: "#ff0000" };
  v.at({ translate: [20, 20] }, () => v.rect(0, 0, 5, 5, red));
  v.rect(0, 0, 5, 5, red);
  assert.deepEqual(rgba(22, 22), [255, 0, 0, 255]);
  assert.deepEqual(rgba(2, 2), [255, 0, 0, 255], "the transform ended with the body");
  assert.throws(() => v.at({ translate: [10, 0] }, () => { throw new Error("boom"); }));
  v.rect(30, 0, 5, 5, red);
  assert.deepEqual(rgba(32, 2), [255, 0, 0, 255], "no leftover translate after the throw");
});

test("erasing inside a rotated at removes the whole shape", () => {
  const { v, alpha } = teaView({ width: 60, height: 60 });
  v.background("#000000");
  v.at({ translate: [30, 30], rotate: Math.PI / 4 }, () => v.rect(-10, -10, 20, 20, { fill: "#fff", erase: true }));
  for (const [x, y] of [[30, 30], [24, 30], [36, 30], [30, 24], [30, 36]] as const) assert.equal(alpha(x, y), 0, `erased at ${x},${y}`);
  assert.equal(alpha(5, 5), 255);
});

test("image and cache take paste options", () => {
  const { v, alpha } = teaView({ width: 40, height: 40 });
  const dot = v.sprite({ key: "dot", width: 10, height: 10 }, () => v.rect(0, 0, 10, 10, { fill: "#000" }));
  v.background("#ffffff");
  v.image(dot, 5, 5, { erase: true });
  assert.equal(alpha(8, 8), 0, "image erased");
  v.cache("square", () => v.rect(20, 20, 10, 10, { fill: "#000" }));
  v.cache("square", () => v.rect(20, 20, 10, 10, { fill: "#000" }), { erase: true });
  assert.equal(alpha(25, 25), 0, "a cache hit pasted with erase");
});

test("single-line text with no box width draws exactly as the old point form", () => {
  const before = teaView({ width: 120, height: 40 });
  before.v.fill("#000000");
  before.v.textSize(16);
  before.v.textAlign("center", "middle");
  before.v.text("Hello", 60, 20);
  const after = teaView({ width: 120, height: 40 });
  after.v.text("Hello", { x: 60, y: 20 }, { size: 16, align: "center", valign: "middle" });
  for (let x = 0; x < 120; x += 1) for (let y = 0; y < 40; y += 1) assert.deepEqual(after.rgba(x, y), before.rgba(x, y), `pixel ${x},${y}`);
});

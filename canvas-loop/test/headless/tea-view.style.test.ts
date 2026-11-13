import assert from "node:assert/strict";
import { test } from "node:test";
import { teaView } from "../helpers.js";

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

test("single-line text with no box width is one native fillText at the point", () => {
  const { v, logs } = teaView({ width: 120, height: 40 });
  const calls: string[] = [];
  const ctx = v.ctx;
  const fillText = ctx.fillText.bind(ctx);
  ctx.fillText = (...args: [string, number, number]): void => {
    const [text, x, y] = args;
    calls.push(`${text}@${x},${y} ${ctx.textAlign}/${ctx.textBaseline} ${ctx.font}`);
    fillText(...args);
  };
  v.text("Hello", { x: 60, y: 20 }, { size: 16, align: "center", valign: "baseline" });
  assert.deepEqual(calls, ["Hello@60,20 center/alphabetic 16px sans-serif"]);
  assert.deepEqual(logs, []);
});

test("a throwing call inside at does not leave its transform behind", () => {
  const { v, rgba } = teaView({ width: 40, height: 40 });
  const bad = v.radialGradient(0, 0, -5, [[0, "#000"], [1, "#fff"]]);
  assert.throws(() => v.at({ translate: [20, 20] }, () => v.background(bad)));
  v.rect(0, 0, 5, 5, { fill: "#ff0000" });
  assert.deepEqual(rgba(2, 2), [255, 0, 0, 255], "drawn at the origin");
});

test("erasing text under a transform removes its pixels", () => {
  const { v, alpha } = teaView({ width: 160, height: 100 });
  v.background("#000000");
  v.at({ translate: [80, 50] }, () => v.text("MMMM", { x: -70, y: -30 }, { size: 24, erase: true }));
  let erased = 0;
  for (let x = 10; x < 80; x += 1) for (let y = 20; y < 50; y += 1) if (alpha(x, y) < 255) erased += 1;
  assert.ok(erased > 100, `erased ${erased} px`);
});

test("a control is placed in canvas coordinates, whatever at scope is open", () => {
  const decl = { n: { type: "number", min: 0, max: 9, default: 3 } } as const;
  const { v, alpha } = teaView({ width: 200, height: 60 }, { decl, values: { n: 3 } });
  v.at({ translate: [100, 0] }, () => v.control("n", { x: 10, y: 10, w: 40 }));
  assert.equal(alpha(30, 11), 255, "the stand-in sits at x=10..50");
  assert.equal(alpha(130, 11), 0, "not moved by the translate");
});

test("multi-line baseline text puts the first line on the same baseline as one line", () => {
  const one = teaView({ width: 200, height: 120 });
  one.v.text("Hello", { x: 10, y: 50 }, { size: 40, valign: "baseline" });
  const two = teaView({ width: 200, height: 120 });
  two.v.text("Hello\nHello", { x: 10, y: 50 }, { size: 40, valign: "baseline" });
  const firstInk = (h: typeof one): number => {
    for (let y = 0; y < 120; y += 1) for (let x = 0; x < 200; x += 1) if (h.alpha(x, y) > 0) return y;
    return -1;
  };
  assert.equal(firstInk(two), firstInk(one));
});

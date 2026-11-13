// A Painter at pixelRatio 2 (a retina browser canvas): sketches draw in logical
// pixels; the backing store holds twice as many in each direction.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import type { Ctx2D, Layer, LayerImage } from "../../../src/core/paint.js";
import { Painter } from "../../../src/core/painter/engine.js";

function skiaLayer(size: { width: number; height: number }): Layer {
  const canvas = createCanvas(size.width, size.height);
  // eslint-disable-next-line no-restricted-syntax -- test boundary: Skia's context and canvas stand in for the structural Ctx2D and LayerImage
  return { ctx: canvas.getContext("2d") as unknown as Ctx2D, image: canvas as unknown as LayerImage };
}

const INK = { stroke: "#000000", weight: 4, brush: { preset: "ink", thinning: 0 }, gesture: { pressure: "even" } } as const;

function densePainter(): { painter: Painter; alpha: (x: number, y: number) => number } {
  const base = skiaLayer({ width: 200, height: 100 });
  const painter = new Painter({ surface: base, width: 100, height: 50, makeLayer: skiaLayer, pixelRatio: 2 });
  const alpha = (x: number, y: number): number => base.ctx.getImageData(x, y, 1, 1).data[3] ?? 0;
  return { painter, alpha };
}

test("shapes land at twice their logical coordinates", () => {
  const { painter, alpha } = densePainter();
  painter.rect(10, 10, 20, 20, { fill: "#000000" });
  assert.equal(alpha(25, 25), 255, "logical (12.5, 12.5)");
  assert.equal(alpha(55, 55), 255, "logical (27.5, 27.5)");
  assert.equal(alpha(65, 65), 0, "logical (32.5, 32.5) is outside");
});

test("a sprite is painted at full density and placed in logical units", () => {
  const { painter, alpha } = densePainter();
  const dot = painter.sprite({ key: "dot", width: 10, height: 10 }, () => {
    painter.rect(0, 0, 10, 10, { fill: "#000000" });
  });
  painter.image(dot, 30, 0);
  assert.equal(alpha(61, 1), 255);
  assert.equal(alpha(79, 19), 255, "the whole 20×20 device area");
  assert.equal(alpha(81, 10), 0);
});

test("brush width scales with density, and background covers the whole canvas", () => {
  const { painter, alpha } = densePainter();
  painter.background("#ffffff");
  assert.equal(alpha(199, 99), 255);
  painter.line(10, 25, 90, 25, INK);
  const { painter: p2, alpha: a2 } = densePainter();
  p2.line(10, 25, 90, 25, INK);
  assert.ok(a2(100, 47) > 0 && a2(100, 53) > 0, "about 8 device px wide around y=50");
  assert.equal(a2(100, 58), 0);
  assert.equal(alpha(100, 50), 255);
});

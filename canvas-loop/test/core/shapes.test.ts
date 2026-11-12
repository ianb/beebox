import assert from "node:assert/strict";
import { test } from "node:test";
import { offsetPoints, tubePath } from "../../src/core/shapes.js";
import type { Vec2 } from "../../src/core/paint.js";

function area(points: readonly Vec2[]): number {
  let a = 0;
  for (const [i, p] of points.entries()) {
    const q = points[(i + 1) % points.length] ?? p;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}

const SQUARE: Vec2[] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];

test("offset grows a shape outward and shrinks it inward, whichever way it winds", () => {
  for (const shape of [SQUARE, SQUARE.toReversed()]) {
    assert.ok(area(offsetPoints(shape, 10)) > area(shape), "positive distance grows");
    assert.ok(area(offsetPoints(shape, -10)) < area(shape), "negative distance shrinks");
  }
});

test("a straight tube is as wide as asked and closed", () => {
  const cmds = tubePath(
    [
      [0, 50],
      [200, 50],
    ],
    { width: 20 },
  );
  assert.deepEqual(cmds.at(-1), ["close"]);
  const ys = cmds.flatMap((c) => (c[0] === "line" || c[0] === "move" ? [c[2]] : []));
  assert.ok(Math.abs(Math.min(...ys) - 40) < 0.5 && Math.abs(Math.max(...ys) - 60) < 0.5, `y range ${Math.min(...ys)}..${Math.max(...ys)}`);
});

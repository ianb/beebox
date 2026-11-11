import assert from "node:assert/strict";
import { test } from "node:test";
import { curveCommands, pathContours } from "../../src/core/contours.js";
import type { Vec2 } from "../../src/core/paint.js";

test("a curve passes through every point it is given", () => {
  const points: Vec2[] = [
    [0, 0],
    [40, 30],
    [90, -10],
    [130, 20],
  ];
  const ends = curveCommands(points, false).map((c) => (c[0] === "bezier" ? [c[5], c[6]] : c[0] === "move" ? [c[1], c[2]] : undefined));
  assert.deepEqual(ends, points);
});

test("a closed curve wraps back to its first point and closes", () => {
  const cmds = curveCommands(
    [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
    true,
  );
  assert.deepEqual(cmds.at(-2)?.slice(5), [0, 0]);
  assert.deepEqual(cmds.at(-1), ["close"]);
});

test("path contours split at each move and mark closed subpaths", () => {
  const contours = pathContours(
    [
      ["move", 0, 0],
      ["line", 10, 0],
      ["line", 10, 10],
      ["close"],
      ["move", 50, 0],
      ["line", 60, 0],
    ],
    1,
  );
  assert.deepEqual(
    contours.map((c) => [c.points.length, c.closed]),
    [
      [3, true],
      [2, false],
    ],
  );
});

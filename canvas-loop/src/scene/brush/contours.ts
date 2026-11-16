// A shape's outline as brush contours, as the Canvas2D painter handed them to a
// brush: rectangles and polygons by their corners,
// round shapes and paths flattened every `step` units of their own coordinates.
import type { Contour } from "../../core/contours.js";
import { ellipseContour, pathContours } from "../../core/contours.js";
import type { Geom } from "../nodes.js";

export function geomContours(g: Geom, step: number): Contour[] {
  switch (g.kind) {
    case "rect":
      return [{ points: [[g.x, g.y], [g.x + g.w, g.y], [g.x + g.w, g.y + g.h], [g.x, g.y + g.h]], closed: true }];
    case "ellipse":
      return [ellipseContour({ x: g.x, y: g.y, rx: g.rx, ry: g.ry, start: 0, end: Math.PI * 2, step })];
    case "arc":
      return [ellipseContour({ x: g.x, y: g.y, rx: g.r, ry: g.r, start: g.start, end: g.end, step })];
    case "poly":
      return [{ points: g.points, closed: g.closed }];
    case "path":
      return pathContours(g.commands, step);
  }
}

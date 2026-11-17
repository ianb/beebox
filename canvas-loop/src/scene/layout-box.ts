// A drawing's layout box (`v.bounds`, `v.row`, `v.column`): what layout needs,
// not the ink. A shape is its geometry (paths flattened, an arc by its swept
// part) grown by half its stroke; text is its line boxes; a placement is its
// picture's declared size. Miter spikes, brush wobble and effects are left
// out, as are backgrounds, lights and debug boxes. The off-canvas check's
// boxes (bounds.ts) are larger on purpose and are not used here.
import type { Bounds } from "../core/paint.js";
import { polylines } from "./geometry/flatten.js";
import { apply } from "./mat.js";
import type { Geom, Mat, SceneNode, ShapeNode } from "./nodes.js";
import { geomBox, transformed, versionRect } from "./bounds.js";
import type { Box } from "./bounds.js";

/** A box with the first baseline found in it, or null for none. */
interface LBox extends Box {
  readonly baseline: number | null;
}

/** Each corner of `b` kept to its side: a rect with a negative width or an ellipse with a negative radius. */
const ordered = (b: Box): Box => ({ x0: Math.min(b.x0, b.x1), y0: Math.min(b.y0, b.y1), x1: Math.max(b.x0, b.x1), y1: Math.max(b.y0, b.y1) });

/** The tight box of a shape's outline: a path's curves are flattened, so a bezier is bounded by its curve, not its control points. */
function outlineBox(g: Geom): Box | null {
  if (g.kind !== "path") {
    const b = geomBox(g);
    // An empty point list gives the empty box (infinite corners): it takes no place.
    return Number.isFinite(b.x0) && Number.isFinite(b.x1) ? ordered(b) : null;
  }
  let box: Box | null = null;
  for (const poly of polylines(g, 1)) {
    for (let i = 0; i + 1 < poly.pts.length; i += 2) {
      const x = poly.pts[i] ?? 0;
      const y = poly.pts[i + 1] ?? 0;
      box = box === null ? { x0: x, y0: y, x1: x, y1: y } : { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) };
    }
  }
  return box;
}

function shapeBox(n: ShapeNode): LBox | null {
  if (n.style.erase) return null;
  const box = outlineBox(n.geom);
  if (box === null) return null;
  const d = n.style.stroke === undefined && n.style.brush === undefined ? 0 : n.style.weight / 2;
  return { x0: box.x0 - d, y0: box.y0 - d, x1: box.x1 + d, y1: box.y1 + d, baseline: null };
}

function union(a: LBox | null, b: LBox | null): LBox | null {
  if (a === null) return b;
  if (b === null) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), baseline: a.baseline ?? b.baseline };
}

/** `b` cut by the union of `shapes` (a clip): null when nothing is left. */
function cut(b: LBox | null, shapes: readonly Geom[]): LBox | null {
  if (b === null) return null;
  let clip: Box | null = null;
  for (const g of shapes) {
    const s = outlineBox(g);
    if (s !== null) clip = clip === null ? s : { x0: Math.min(clip.x0, s.x0), y0: Math.min(clip.y0, s.y0), x1: Math.max(clip.x1, s.x1), y1: Math.max(clip.y1, s.y1) };
  }
  if (clip === null) return null;
  const x0 = Math.max(b.x0, clip.x0);
  const y0 = Math.max(b.y0, clip.y0);
  const x1 = Math.min(b.x1, clip.x1);
  const y1 = Math.min(b.y1, clip.y1);
  return x0 > x1 || y0 > y1 ? null : { x0, y0, x1, y1, baseline: b.baseline };
}

/** `b` under `m`, the box around its four corners; the baseline survives only a matrix with no rotation or skew. */
function moved(m: Mat, b: LBox | null): LBox | null {
  if (b === null) return null;
  const box = transformed(m, b);
  const straight = m[1] === 0 && m[2] === 0;
  return { ...box, baseline: straight && b.baseline !== null ? apply(m, [0, b.baseline])[1] : null };
}

function listBox(nodes: readonly SceneNode[]): LBox | null {
  let box: LBox | null = null;
  for (const n of nodes) box = union(box, nodeBox(n));
  return box;
}

function nodeBox(n: SceneNode): LBox | null {
  switch (n.kind) {
    case "shape":
      return shapeBox(n);
    case "text":
      return { x0: n.box.x, y0: n.box.y, x1: n.box.x + n.box.w, y1: n.box.y + n.box.h, baseline: n.baselineY };
    case "at":
      return moved(n.matrix, listBox(n.children));
    case "group":
      return n.clip === undefined ? listBox(n.children) : cut(listBox(n.children), n.clip);
    case "clip":
      return cut(listBox(n.children), n.shapes);
    case "mask":
      return listBox(n.body);
    case "place":
    {
      const r = versionRect(n.picture);
      return { x0: n.x + r.x0, y0: n.y + r.y0, x1: n.x + r.x1, y1: n.y + r.y1, baseline: null };
    }
    case "background":
    case "light":
    case "debug":
      return null;
  }
}

/** The layout box of `nodes` in their own coordinates, or null when they draw nothing a layout can place. */
export function layoutBox(nodes: readonly SceneNode[]): Bounds | null {
  const b = listBox(nodes);
  return b === null ? null : { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0, baseline: b.baseline };
}

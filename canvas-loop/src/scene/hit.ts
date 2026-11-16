// The hit walk (plan:canvas-loop-layout-text-hits.subplan, Track B): which
// named drawing of a recorded scene is under a point. Pure: the answer is a
// function of the scene and the point. The walk goes topmost first (children
// last to first), carries the point into each node's own coordinates, and
// stops at the first hit area that has a named node on its path. Unnamed
// drawings are not candidates, so a label over a named pan does not block it.
// Hit areas follow what the renderer draws (lower.ts): a fill by nonzero
// winding, a plain stroke by the renderer's own stroke rings, a brushed stroke
// by a band of weight / 2 without wobble, text by its box, a background by the
// canvas or the picture body's box, a pixels placement by its box. Clips cut;
// mask artwork, effects, opacity and erasing drawings take no part. There is
// no box rejection: no box kept on a node contains every hit area.
import type { Vec2 } from "../core/paint.js";
import { polylines } from "./geometry/flatten.js";
import type { Poly } from "./geometry/flatten.js";
import { dashPolys } from "./geometry/dash.js";
import { dotRings, strokeRings } from "./geometry/stroke.js";
import { IDENTITY, apply, invert, maxScale, mul } from "./mat.js";
import type { Geom, Mat, PictureVersion, PlaceNode, Scene, SceneNode, ShapeNode, ShapeStyle } from "./nodes.js";

/** What is under a point: the innermost name and the named path, innermost first (`target === targets[0]`). */
export interface Hit {
  readonly target: string | undefined;
  readonly targets: readonly string[];
}

/** Where the walk is: the point in the current coordinates, the transform to canvas (for flattening), whether a background here covers the point, and the names around, outermost first. */
interface Here {
  readonly p: Vec2;
  readonly matrix: Mat;
  readonly ground: boolean;
  readonly names: readonly string[];
}

const MISS: Hit = { target: undefined, targets: [] };

/** Whether a node or a picture body holds a name anywhere, kept per object: picture versions and their nodes live across frames. */
const holds = new WeakMap<SceneNode | PictureVersion, boolean>();

function nameOf(n: SceneNode): string | undefined {
  return n.kind === "shape" || n.kind === "text" || n.kind === "at" || n.kind === "group" || n.kind === "place" ? n.name : undefined;
}

function holdsName(n: SceneNode): boolean {
  const known = holds.get(n);
  if (known !== undefined) return known;
  let found = nameOf(n) !== undefined;
  if (!found) {
    if (n.kind === "at" || n.kind === "group" || n.kind === "clip") found = n.children.some(holdsName);
    else if (n.kind === "mask") found = n.body.some(holdsName);
    else if (n.kind === "place" && n.picture.kind === "picture") found = bodyHoldsName(n.picture);
  }
  holds.set(n, found);
  return found;
}

function bodyHoldsName(v: PictureVersion): boolean {
  const known = holds.get(v);
  if (known !== undefined) return known;
  const found = v.children.some(holdsName);
  holds.set(v, found);
  return found;
}

/** Winding number of closed ring `r` (flat `[x0, y0, x1, y1, …]`) about `p`. */
function winding(r: readonly number[], p: Vec2): number {
  const [px, py] = p;
  let w = 0;
  const n = r.length;
  for (let i = 0; i < n; i += 2) {
    const x0 = r[i] ?? 0;
    const y0 = r[i + 1] ?? 0;
    const x1 = r[(i + 2) % n] ?? 0;
    const y1 = r[(i + 3) % n] ?? 0;
    const side = (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0);
    if (y0 <= py) {
      if (y1 > py && side > 0) w++;
    } else if (y1 <= py && side < 0) w--;
  }
  return w;
}

function inBox(b: { x: number; y: number; w: number; h: number }, p: Vec2): boolean {
  return p[0] >= Math.min(b.x, b.x + b.w) && p[0] <= Math.max(b.x, b.x + b.w) && p[1] >= Math.min(b.y, b.y + b.h) && p[1] <= Math.max(b.y, b.y + b.h);
}

/** Whether `g`'s fill covers the point: rectangles and ellipses exactly, the rest flattened for the scale on screen, by nonzero winding. */
function filled(g: Geom, h: Here): boolean {
  if (g.kind === "rect") return inBox(g, h.p);
  if (g.kind === "ellipse") {
    if (g.rx === 0 || g.ry === 0) return false;
    const dx = (h.p[0] - g.x) / g.rx;
    const dy = (h.p[1] - g.y) / g.ry;
    return dx * dx + dy * dy <= 1;
  }
  const polys = polylines(g, maxScale(h.matrix));
  return polys.reduce((w, poly) => w + winding(poly.pts, h.p), 0) !== 0;
}

/** Whether the point is within `r` of an outline (its closing segment too when closed). */
function near(poly: Poly, a: { p: Vec2; r: number }): boolean {
  const pts = poly.pts;
  const n = pts.length / 2;
  const segs = poly.closed ? n : n - 1;
  const [px, py] = a.p;
  for (let i = 0; i < Math.max(segs, 1); i++) {
    const x0 = pts[2 * i] ?? 0;
    const y0 = pts[2 * i + 1] ?? 0;
    const x1 = pts[(2 * i + 2) % pts.length] ?? x0;
    const y1 = pts[(2 * i + 3) % pts.length] ?? y0;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
    if (Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy)) <= a.r) return true;
  }
  return false;
}

/** A plain stroke's rings, dashes split off first: the same steps as the renderer's (gpu/shape-geometry.ts). */
function plainStrokeRings(polys: readonly Poly[], at: { style: ShapeStyle; scale: number }): number[][] {
  const dash = at.style.dash;
  return polys.flatMap((p) => {
    if (dash === undefined) return strokeRings(p, at);
    const { pieces, dots } = dashPolys(p, dash);
    return [...pieces.flatMap((q) => strokeRings(q, at)), ...dots.flatMap((d) => dotRings(d, at))];
  });
}

/** A shape's hit area: its fill (any paint, `"transparent"` too) and its stroke. An erasing shape has none. */
function shapeHit(n: ShapeNode, h: Here): boolean {
  const s = n.style;
  if (s.erase) return false;
  if (s.fill !== undefined && filled(n.geom, h)) return true;
  if (s.stroke === undefined || s.weight <= 0) return false;
  const scale = maxScale(h.matrix);
  const polys = polylines(n.geom, scale);
  if (s.brush !== undefined) return polys.some((poly) => near(poly, { p: h.p, r: s.weight / 2 }));
  return plainStrokeRings(polys, { style: s, scale }).some((r) => winding(r, h.p) !== 0);
}

/** `h` moved into a scope with transform `m`, or undefined when `m` cannot be inverted (it draws nothing). */
function under(h: Here, m: Mat): Here | undefined {
  const inv = invert(m);
  if (inv === undefined) return undefined;
  return { ...h, p: apply(inv, h.p), matrix: mul(h.matrix, m) };
}

function hitOf(names: readonly string[]): Hit | undefined {
  return names.length === 0 ? undefined : { target: names.at(-1), targets: names.toReversed() };
}

function walk(nodes: readonly SceneNode[], h: Here): Hit | undefined {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const hit = n === undefined ? undefined : node(n, h);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** R7: the picture's body under the placement's translation, its background on the picture's box; a pixels image by its box. */
function place(n: PlaceNode, h: Here): Hit | undefined {
  if (n.erase) return undefined;
  const inner = under(h, [1, 0, 0, 1, n.x, n.y]);
  if (inner === undefined) return undefined;
  const v = n.picture;
  const ground = inBox({ x: 0, y: 0, w: v.width, h: v.height }, inner.p);
  if (v.kind === "pixels") return ground ? hitOf(h.names) : undefined;
  return walk(v.children, { ...inner, ground });
}

function node(n: SceneNode, outer: Here): Hit | undefined {
  // A subtree with no name and no named node around it holds no candidate.
  if (outer.names.length === 0 && !holdsName(n)) return undefined;
  const name = nameOf(n);
  const h = name === undefined ? outer : { ...outer, names: [...outer.names, name] };
  switch (n.kind) {
    case "shape":
      return shapeHit(n, h) ? hitOf(h.names) : undefined;
    case "text":
      return !n.erase && inBox(n.box, h.p) ? hitOf(h.names) : undefined;
    case "background":
      return h.ground ? hitOf(h.names) : undefined;
    case "at": {
      const inner = under(h, n.matrix);
      return inner === undefined ? undefined : walk(n.children, inner);
    }
    case "group":
      if (n.clip !== undefined && !n.clip.some((g) => filled(g, h))) return undefined;
      return walk(n.children, h);
    case "clip":
      return n.shapes.some((g) => filled(g, h)) ? walk(n.children, h) : undefined;
    case "mask":
      return walk(n.body, h);
    case "place":
      return place(n, h);
    case "light":
    case "debug":
      return undefined;
  }
}

/** The named drawing under `point` (canvas coordinates) in `scene`: topmost first, innermost name first. */
export function hitTest(scene: Scene, point: Vec2): Hit {
  const ground = inBox({ x: 0, y: 0, w: scene.width, h: scene.height }, point);
  return walk(scene.children, { p: point, matrix: IDENTITY, ground, names: [] }) ?? MISS;
}

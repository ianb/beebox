// Conservative boxes around what a drawing can put on the canvas, for the
// off-canvas check (off-canvas.ts): a shape's outline (an arc by its swept
// part), a stroke's width, a brush's spread, the reach of effects, text's
// laid-out lines, and a picture version's whole body. A box may be larger
// than the ink, never smaller; `undefined` means "can reach anywhere" (a light,
// or a shadow caster in a lit room).
import type { Effects, Material } from "../../scene-draft/scene-api.js";
import { arcSweep } from "../geometry/flatten.js";
import { apply, matrixOf, maxScale, mul } from "../mat.js";
import type { Geom, Mat, PictureVersion, PixelsVersion, SceneNode, ShapeStyle } from "../scene.js";

export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const EMPTY: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };

export function boxOf(points: readonly (readonly [number, number])[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const pad = (b: Box, d: number): Box => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });

/** `b` under `m`: the box around its four corners. */
export function transformed(m: Mat, b: Box): Box {
  if (b.x0 > b.x1) return b;
  return boxOf([apply(m, [b.x0, b.y0]), apply(m, [b.x1, b.y0]), apply(m, [b.x0, b.y1]), apply(m, [b.x1, b.y1])]);
}

/** An arc's swept part (its fill closes the chord): the end points and every axis direction it passes. */
function arcBox(g: Extract<Geom, { kind: "arc" }>): Box {
  const { sweep } = arcSweep(g.start, g.end);
  const at = (a: number): [number, number] => [g.x + g.r * Math.cos(a), g.y + g.r * Math.sin(a)];
  const pts = [at(g.start), at(g.start + sweep)];
  for (let k = Math.ceil(g.start / (Math.PI / 2)); k * (Math.PI / 2) <= g.start + sweep; k++) pts.push(at(k * (Math.PI / 2)));
  return boxOf(pts);
}

/** A box around the shape's outline in its own coordinates (a path's control points bound its curves). */
export function geomBox(g: Geom): Box {
  switch (g.kind) {
    case "rect":
      return boxOf([[g.x, g.y], [g.x + g.w, g.y + g.h]]);
    case "ellipse":
      return { x0: g.x - g.rx, y0: g.y - g.ry, x1: g.x + g.rx, y1: g.y + g.ry };
    case "arc":
      return arcBox(g);
    case "poly":
      return boxOf(g.points);
    case "path": {
      const pts: [number, number][] = [];
      for (const c of g.commands) for (let i = 1; i + 1 < c.length; i += 2) pts.push([Number(c[i]), Number(c[i + 1])]);
      return boxOf(pts);
    }
  }
}

/** How far effects can carry ink past what they apply to, in the coordinates they are called in. */
export function effectsReach(e: Effects | undefined): number {
  if (e === undefined) return 0;
  const shadow = e.shadow === undefined ? 0 : Math.abs(e.shadow.x ?? 0) + Math.abs(e.shadow.y ?? 0) + 3 * (e.shadow.blur ?? 0);
  return Math.max(3 * (e.blur ?? 0), 3 * (e.glow?.blur ?? 0), shadow, (e.wash?.bleed ?? 0) * Math.SQRT2);
}

/** A shape's outline padded by how far its ink reaches: half the stroke (a miter can reach 5 weights), a brush's spread, its own effects. */
export function shapeBox(g: Geom, s: ShapeStyle): Box {
  const stroke = s.stroke === undefined && s.brush === undefined ? 0 : s.brush !== undefined ? 2 * s.weight : s.join === "miter" ? 5 * s.weight : s.weight;
  return pad(geomBox(g), stroke + effectsReach(s.effects));
}

const casts = (m: Material | undefined): boolean => (m?.castsShadow ?? false) !== false;
const kept = new WeakMap<PictureVersion, Box | undefined>();

/** Everything a version's body draws, in its own coordinates, or undefined when it holds a light or a shadow caster (placed in a lit room, it can reach anywhere). */
export function versionBox(v: PictureVersion | PixelsVersion): Box | undefined {
  if (v.kind === "pixels") return { x0: 0, y0: 0, x1: v.width, y1: v.height };
  if (kept.has(v)) return kept.get(v);
  const box = nodesBox(v.children, { m: [1, 0, 0, 1, 0, 0], v });
  kept.set(v, box);
  return box;
}

function nodesBox(nodes: readonly SceneNode[], a: { m: Mat; v: PictureVersion }): Box | undefined {
  let box = EMPTY;
  for (const n of nodes) {
    const b = nodeBox(n, a);
    if (b === undefined) return undefined;
    box = union(box, b);
  }
  return box;
}

function nodeBox(n: SceneNode, a: { m: Mat; v: PictureVersion }): Box | undefined {
  const { m } = a;
  switch (n.kind) {
    case "shape":
      return casts(n.style.material) ? undefined : transformed(m, shapeBox(n.geom, n.style));
    case "text": {
      // Each line from its first pen position to two sizes past its last (a glyph is narrower), a line height either side.
      const halo = n.halo?.width ?? 0;
      const lines = n.lines.map((l): Box => pad({ x0: Math.min(...l.xs), y0: l.y - 1.5 * n.size, x1: Math.max(...l.xs) + 2 * n.size, y1: l.y + 1.5 * n.size }, halo));
      return transformed(m, lines.reduce(union, EMPTY));
    }
    case "background":
      return transformed(m, { x0: 0, y0: 0, x1: a.v.width, y1: a.v.height });
    case "at":
      return nodesBox(n.children, { ...a, m: mul(m, n.matrix) });
    case "group": {
      const inner = nodesBox(n.children, a);
      return inner === undefined ? undefined : pad(inner, effectsReach(n.effects) * maxScale(m));
    }
    case "clip":
      return nodesBox(n.children, a);
    case "mask":
      return nodesBox(n.body, a);
    case "place": {
      if (casts(n.material)) return undefined;
      const inner = versionBox(n.picture);
      return inner === undefined ? undefined : transformed(mul(m, matrixOf({ translate: [n.x, n.y] })), inner);
    }
    case "light":
      return undefined;
    case "debug":
      return EMPTY;
  }
}

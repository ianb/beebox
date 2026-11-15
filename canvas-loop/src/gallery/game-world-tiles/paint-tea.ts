// Painted pieces shared by the ground and the props: irregular blobs, brushed
// foliage, and sprites painted at the map's zoom so they stay sharp.
import type { BrushPreset, ScenePicture as Picture, Vec2, SceneView as View } from "@ianbicking/canvas-loop";
import { hash } from "./map-tea.js";

/** The map is drawn at this multiple of game-world's pixel size. */
export const ZOOM = 2;

/** A sprite painted at ZOOM× its logical size. `body` draws in logical units. */
export function paintedSprite(v: View, a: { key: string; w: number; h: number }, body: () => void): Picture {
  return v.picture({ key: a.key, width: Math.ceil(a.w * ZOOM), height: Math.ceil(a.h * ZOOM) }, () => {
    v.at({ scale: ZOOM }, body);
  });
}

/** Draws a paintedSprite with its top-left at (x, y) in logical units. */
export function placeSprite(v: View, sprite: Picture, x: number, y: number): void {
  v.at({ scale: 1 / ZOOM }, () => v.place(sprite, x * ZOOM, y * ZOOM));
}

/** An irregular closed outline around (cx, cy): `n` points at jittered radii,
 * squashed vertically by `squash`. Stable for a given (x, y, salt). */
export function blob(a: { cx: number; cy: number; r: number; x: number; y: number; salt: number; n?: number; squash?: number; rough?: number }): Vec2[] {
  const n = a.n ?? 9;
  const rough = a.rough ?? 0.22;
  const turn = hash(a.x, a.y, a.salt) * Math.PI * 2;
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const ang = turn + (i / n) * Math.PI * 2;
    const rr = a.r * (1 - rough / 2 + hash(a.x, a.y, a.salt + 1 + i) * rough);
    pts.push([a.cx + Math.cos(ang) * rr, a.cy + Math.sin(ang) * rr * (a.squash ?? 1)]);
  }
  return pts;
}

export interface Leafage {
  shadow: string;
  dark: string;
  mid: string;
  light: string;
  glint: string;
}

const LEAF_BRUSHES: Record<string, BrushPreset> = {
  bristle: { preset: "bristle", lightJitter: 0.06, hueJitter: 6 },
  chalk: { preset: "chalk", lightJitter: 0.05, hueJitter: 5 },
};

/** One clump of leaves: a dark body, then short leaf dabs that hang down and to
 * the right, lighter toward the upper left where the light comes from. */
function clump(v: View, a: { cx: number; cy: number; r: number; look: Leafage; x: number; y: number; salt: number; brush: BrushPreset }): void {
  const { cx, cy, r, look, x, y, salt } = a;
  const outline = blob({ cx, cy, r, x, y, salt, n: 11, squash: 0.85, rough: 0.4 });
  v.curve(outline, true, { fill: look.dark });
  const body = outline.map(([px, py]): Vec2 => [cx + (px - cx) * 0.86 - r * 0.08, cy + (py - cy) * 0.8 - r * 0.14]);
  v.curve(body, true, { fill: look.mid });
  const n = Math.round(6 + r * r * 0.22);
  for (let k = 0; k < n; k++) {
    const ang = hash(x, y, salt + 100 + k) * Math.PI * 2;
    const d = Math.sqrt(hash(x, y, salt + 200 + k)) * r * 0.95;
    const lx = cx + Math.cos(ang) * d, ly = cy + Math.sin(ang) * d * 0.85;
    const lit = (-(lx - cx) * 0.55 - (ly - cy) * 0.85) / r + (hash(x, y, salt + 300 + k) - 0.5) * 0.6;
    if (lit < -0.45) continue;
    const stroke = lit > 0.65 ? look.glint : lit > 0.2 ? look.light : lit > -0.15 ? look.mid : look.dark;
    const len = 2.2 + hash(x, y, salt + 400 + k) * 2.2;
    const dir = 1.05 + (hash(x, y, salt + 500 + k) - 0.5) * 0.9;
    const ex = Math.cos(dir) * len, ey = Math.sin(dir) * len;
    v.line(lx - ex, ly - ey, lx + ex, ly + ey, { stroke, weight: 2.6 + r * 0.12, brush: a.brush, gesture: { pressure: "taper-out" } });
  }
  rim(v, { ...a, n: Math.round(5 + r * 0.9), size: 1 });
}

/** Leaves sticking out past an outline, so its edge is ragged instead of a curve. */
function rim(v: View, a: { cx: number; cy: number; r: number; look: Leafage; x: number; y: number; salt: number; brush: BrushPreset; n: number; size: number }): void {
  const { cx, cy, r, look, x, y, salt, size } = a;
  for (let k = 0; k < a.n; k++) {
    const ang = (k / a.n) * Math.PI * 2 + hash(x, y, salt + 700 + k) * 0.5;
    const ox = Math.cos(ang), oy = Math.sin(ang) * 0.85;
    const lit = -ox * 0.55 - oy * 0.85;
    const stroke = lit > 0.5 ? look.light : lit > -0.2 ? look.mid : look.dark;
    const sx = cx + ox * r * 0.8, sy = cy + oy * r * 0.8;
    const len = (2.5 + hash(x, y, salt + 720 + k) * 3) * size;
    // Out from the rim and drooping a little.
    v.line(sx, sy, sx + ox * len, sy + oy * len + 1.2, { stroke, weight: 2.8 * size, brush: a.brush, gesture: { pressure: "taper-out" } });
  }
}

/** A mass of leaves: a shadow under it, then clumps from the back and bottom up
 * to the front and top, each lit on its upper left. */
export function foliage(v: View, a: { cx: number; cy: number; r: number; look: Leafage; x: number; y: number; salt: number; brush?: string }): void {
  const { cx, cy, r, look, x, y, salt } = a;
  const brush = LEAF_BRUSHES[a.brush ?? "bristle"] ?? { preset: "bristle" };
  v.curve(blob({ cx: cx + r * 0.05, cy: cy + r * 0.12, r: r * 0.86, x, y, salt, n: 14, squash: 0.85, rough: 0.35 }), true, { fill: look.shadow });
  const count = Math.max(4, Math.round(r / 3.6));
  const parts: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const ang = hash(x, y, salt + 600 + i) * Math.PI * 2;
    const d = Math.sqrt(hash(x, y, salt + 610 + i)) * r * 0.62;
    parts.push([cx + Math.cos(ang) * d, cy + Math.sin(ang) * d * 0.8, r * (0.42 + hash(x, y, salt + 620 + i) * 0.2)]);
  }
  // The crown's body, so gaps between clumps read as depth, not holes.
  v.curve(blob({ cx, cy, r: r * 0.8, x, y, salt: salt + 7, n: 13, squash: 0.85, rough: 0.35 }), true, { fill: look.dark });
  rim(v, { cx, cy: cy + r * 0.1, r: r * 0.92, look: { ...look, light: look.dark, mid: look.dark, dark: look.shadow }, x, y, salt: salt + 9, brush, n: Math.round(10 + r * 1.4), size: 1 + r * 0.04 });
  // Lower clumps first; the top clumps catch the most light and sit in front.
  parts.sort((p, q) => q[1] - p[1]);
  for (const [i, [px, py, pr]] of parts.entries()) clump(v, { cx: px, cy: py, r: pr, look, x, y, salt: salt + 1000 + i * 50, brush });
}

/** Leafage palettes. */
export const LEAVES: Record<string, Leafage> = {
  green: { shadow: "#1d3a22", dark: "#2c5a2e", mid: "#3f7a36", light: "#6a9f45", glint: "#a3c868" },
  oak: { shadow: "#17321f", dark: "#24502c", mid: "#356a35", light: "#5a8f40", glint: "#8fb85a" },
  autumn: { shadow: "#4d2410", dark: "#8a3b17", mid: "#c0602a", light: "#e39342", glint: "#f5c06a" },
  young: { shadow: "#24502a", dark: "#36702f", mid: "#4f9140", light: "#7fbb55", glint: "#b5dc7a" },
  forest: { shadow: "#132619", dark: "#1f4127", mid: "#2f5d33", light: "#4f8040", glint: "#7aa555" },
  bush: { shadow: "#1d3a20", dark: "#2f5f2c", mid: "#457f37", light: "#6aa04a", glint: "#9cc76a" },
};

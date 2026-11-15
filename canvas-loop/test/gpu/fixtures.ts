// Compositing fixtures from the Stage 3 probe (scratch/stage3/compositing/fixtures.ts),
// as data with two lowerings: draft 2.2 calls (the scene renderer) and today's calls
// (the Skia renderer), as the probe's skia-lower.ts wrote them.
import { BLEND_MODES } from "../../src/core/compose.js";
import { SketchUsageError } from "../../src/core/errors.js";
import type { BlendMode, LinearGradient, Vec2 } from "../../src/core/paint.js";
import type { View as TodayView } from "../../src/core/tea.js";
import type { Effects } from "../../src/scene/api.js";
import type { View as DraftView } from "../../src/scene/api.js";

type Fill = string | LinearGradient;
type Geom = { k: "rect"; x: number; y: number; w: number; h: number } | { k: "circle"; x: number; y: number; r: number } | { k: "poly"; pts: readonly Vec2[] };
interface ShapeStyle { fill: Fill; blend?: BlendMode; erase?: boolean; effects?: Effects }
export type FxNode =
  | { t: "shape"; g: Geom; s: ShapeStyle }
  | { t: "group"; opacity?: number; blend?: BlendMode; effects?: Effects; clip?: readonly (readonly Vec2[])[]; body: readonly FxNode[] }
  | { t: "clip"; shapes: readonly (readonly Vec2[])[]; body: readonly FxNode[] }
  | { t: "mask"; mask: readonly FxNode[]; body: readonly FxNode[] };

export interface Fixture {
  readonly name: string;
  readonly rect: readonly [number, number, number, number];
  readonly nodes: readonly FxNode[];
}

const rect = (...[x, y, w, h, s]: [number, number, number, number, ShapeStyle | string]): FxNode => ({ t: "shape", g: { k: "rect", x, y, w, h }, s: typeof s === "string" ? { fill: s } : s });
const circle = (...[x, y, r, s]: [number, number, number, ShapeStyle | string]): FxNode => ({ t: "shape", g: { k: "circle", x, y, r }, s: typeof s === "string" ? { fill: s } : s });
const circlePts = (...[cx, cy, r]: [number, number, number]): Vec2[] => Array.from({ length: 96 }, (_, i): Vec2 => [cx + r * Math.cos((2 * Math.PI * i) / 96), cy + r * Math.sin((2 * Math.PI * i) / 96)]);
const star = (...[cx, cy, r1, r2]: [number, number, number, number]): Vec2[] =>
  Array.from({ length: 10 }, (_, i): Vec2 => [cx + (i % 2 === 0 ? r1 : r2) * Math.cos(-Math.PI / 2 + (Math.PI * i) / 5), cy + (i % 2 === 0 ? r1 : r2) * Math.sin(-Math.PI / 2 + (Math.PI * i) / 5)]);
function rotRect(o: { cx: number; cy: number; w: number; h: number; a: number }): Vec2[] {
  const c = Math.cos(o.a);
  const s = Math.sin(o.a);
  return ([[-o.w / 2, -o.h / 2], [o.w / 2, -o.h / 2], [o.w / 2, o.h / 2], [-o.w / 2, o.h / 2]] as const).map(([x, y]): Vec2 => [o.cx + x * c - y * s, o.cy + x * s + y * c]);
}

/** Four coloured bars, one a gradient fading to 30% alpha. */
function backdrop(x: number, y: number): FxNode[] {
  const g: LinearGradient = { kind: "linear-gradient", x1: 0, y1: y + 30, x2: 0, y2: y + 150, stops: [[0, "#264653"], [1, "rgba(233,196,106,0.3)"]] };
  return [rect(x + 10, y + 30, 45, 120, "#e63946"), rect(x + 55, y + 30, 45, 120, "#2a9d8f"), rect(x + 100, y + 30, 45, 120, "#f4a261"), rect(x + 145, y + 30, 45, 120, { fill: g })];
}
const clipBody = (x: number, y: number): FxNode[] => [rect(x + 25, y + 15, 150, 140, "#ffd166"), circle(x + 70, y + 95, 22, { fill: "#000", erase: true }), rect(x + 95, y + 50, 80, 80, { fill: "#06d6a0", blend: "multiply" })];
const blurBody = (x: number, y: number): FxNode[] => [circle(x + 85, y + 88, 50, "#3a86ff"), rect(x + 95, y + 45, 70, 50, "#ff006e")];

type Build = (x: number, y: number) => FxNode[];
const CASES: Record<string, Build> = {
  opacity: (x, y) => [...backdrop(x, y), { t: "group", opacity: 0.5, body: [circle(x + 75, y + 90, 40, "#1d3557"), circle(x + 115, y + 90, 40, "#1d3557"), rect(x + 85, y + 40, 60, 40, "#ffb703")] }],
  "erase-shape": (x, y) => [...backdrop(x, y), circle(x + 70, y + 90, 32, { fill: "#000", erase: true }), rect(x + 110, y + 15, 70, 110, { fill: "rgba(0,0,0,0.5)", erase: true })],
  "erase-group": (x, y) => [...backdrop(x, y), { t: "group", body: [rect(x + 30, y + 45, 140, 90, "#3a0ca3"), circle(x + 100, y + 90, 30, { fill: "#000", erase: true })] }],
  "erase-soft": (x, y) => [...backdrop(x, y), circle(x + 100, y + 90, 35, { fill: "#000", erase: true, effects: { blur: 6 } })],
  "erase-clip": (x, y) => [...backdrop(x, y), { t: "clip", shapes: [star(x + 100, y + 90, 62, 28)], body: [circle(x + 100, y + 90, 55, { fill: "#000", erase: true })] }],
  "clip-single": (x, y) => [...backdrop(x, y), { t: "clip", shapes: [star(x + 100, y + 88, 70, 30)], body: clipBody(x, y) }],
  "clip-union": (x, y) => [...backdrop(x, y), { t: "clip", shapes: [circlePts(x + 65, y + 95, 45), rotRect({ cx: x + 135, cy: y + 80, w: 60, h: 110, a: 0.5 })], body: clipBody(x, y) }],
  "mask-gradient": (x, y) => [...backdrop(x, y), { t: "mask", mask: [rect(x + 15, y + 20, 170, 130, { fill: { kind: "linear-gradient", x1: x + 15, y1: 0, x2: x + 185, y2: 0, stops: [[0, "#000"], [1, "rgba(0,0,0,0)"]] } })], body: [rect(x + 20, y + 25, 160, 120, "#7209b7"), circle(x + 100, y + 85, 45, "#f72585")] }],
  "mask-blur": (x, y) => [...backdrop(x, y), { t: "mask", mask: [{ t: "group", effects: { blur: 10 }, body: [circle(x + 100, y + 90, 42, "#000")] }], body: Array.from({ length: 8 }, (_, i) => rect(x + 30 + i * 18, y + 30, 9, 120, i % 2 === 0 ? "#ffbe0b" : "#3a0ca3")) }],
  "group-clip-opt": (x, y) => [...backdrop(x, y), { t: "group", effects: { blur: 5 }, clip: [star(x + 100, y + 88, 70, 32)], body: blurBody(x, y) }],
  "clip-in-body": (x, y) => [...backdrop(x, y), { t: "group", effects: { blur: 5 }, body: [{ t: "clip", shapes: [star(x + 100, y + 88, 70, 32)], body: blurBody(x, y) }] }],
  blur: (x, y) => [...backdrop(x, y), { t: "group", effects: { blur: 4 }, body: [rect(x + 40, y + 50, 70, 70, "#023e8a"), circle(x + 125, y + 85, 35, "rgba(255,255,255,0.8)")] }],
  glow: (x, y) => [...backdrop(x, y), { t: "group", effects: { glow: { blur: 8, color: "#ffea00", strength: 2 } }, body: [circle(x + 80, y + 90, 28, "#2ec4b6"), rect(x + 110, y + 60, 50, 60, "#03045e")] }],
  shadow: (x, y) => [...backdrop(x, y), { t: "group", effects: { shadow: { x: 6, y: 8, blur: 6, color: "rgba(0,0,0,0.6)" } }, body: [circle(x + 80, y + 80, 30, "#fefae0"), rect(x + 105, y + 55, 55, 55, "#90e0ef")] }],
  adjust: (x, y) => [...backdrop(x, y), { t: "group", effects: { hue: 40, saturation: 1.4, brightness: 0.9, contrast: 1.2, grayscale: 0.2, sepia: 0.3, invert: 0.1 }, body: [rect(x + 20, y + 40, 50, 100, "#e63946"), rect(x + 70, y + 40, 50, 100, "#2a9d8f"), rect(x + 120, y + 40, 50, 100, "rgba(69,123,157,0.6)"), circle(x + 100, y + 90, 25, "#ffd166")] }],
  "shape-fx-multiply": (x, y) => [...backdrop(x, y), rect(x + 50, y + 50, 100, 70, { fill: "#4cc9f0", blend: "multiply", effects: { glow: { blur: 6, color: "#f72585", strength: 2 } } })],
  combo: (x, y) => [...backdrop(x, y), { t: "group", blend: "screen", opacity: 0.7, effects: { blur: 2 }, clip: [circlePts(x + 100, y + 90, 55)], body: [rect(x + 30, y + 30, 140, 50, "#4361ee"), rect(x + 30, y + 90, 140, 50, "#f72585")] }],
};
const blendCase = (m: BlendMode): Build => (x, y) => [
  ...backdrop(x, y),
  circle(x + 60, y + 95, 38, { fill: "rgba(255,190,11,0.85)", blend: m }),
  rect(x + 20, y + 8, 60, 34, { fill: "#8338ec", blend: m }),
  { t: "group", blend: m, body: [circle(x + 150, y + 100, 30, "#ff006e"), rect(x + 115, y + 8, 60, 70, "rgba(58,134,255,0.7)")] },
];

/** Fixtures laid out in cells of 200 × 160, `cols` across. */
export function fixtures(names: readonly string[], cols: number): Fixture[] {
  return names.map((name, i) => {
    const x = (i % cols) * 200;
    const y = Math.floor(i / cols) * 160;
    const mode = BLEND_MODES.find((m) => `blend-${m}` === name);
    const build = CASES[name] ?? (mode === undefined ? undefined : blendCase(mode));
    if (build === undefined) throw new SketchUsageError({ detail: `no compositing fixture "${name}"` });
    return { name, rect: [x, y, 200, 160], nodes: build(x, y) };
  });
}

export const CASE_NAMES = Object.keys(CASES);

function draftShape(v: DraftView, n: Extract<FxNode, { t: "shape" }>): void {
  const { g, s } = n;
  const style = { fill: s.fill, ...(s.blend === undefined ? {} : { blend: s.blend }), ...(s.erase === true ? { erase: true } : {}), ...(s.effects === undefined ? {} : { effects: s.effects }) };
  if (g.k === "rect") v.rect(g.x, g.y, g.w, g.h, style);
  else if (g.k === "circle") v.circle(g.x, g.y, g.r, style);
  else v.polygon(g.pts, style);
}

/** Draft 2.2 calls: shape effects, the group clip option, and erase with effects are native. */
export function drawDraft(v: DraftView, nodes: readonly FxNode[]): void {
  for (const n of nodes) {
    if (n.t === "shape") draftShape(v, n);
    else if (n.t === "group") v.group({ ...(n.opacity === undefined ? {} : { opacity: n.opacity }), ...(n.blend === undefined ? {} : { blend: n.blend }), ...(n.effects === undefined ? {} : { effects: n.effects }), ...(n.clip === undefined ? {} : { clip: n.clip }) }, () => drawDraft(v, n.body));
    else if (n.t === "clip") v.clip(n.shapes, () => drawDraft(v, n.body));
    else v.mask(() => drawDraft(v, n.mask), () => drawDraft(v, n.body));
  }
}

let cacheKey = 0;

/** Today's calls: a shape's effects become a group around it; erase with effects pastes a cache; the group clip option becomes a clip around the group. */
export function drawToday(v: TodayView, nodes: readonly FxNode[]): void {
  for (const n of nodes) {
    if (n.t === "shape") {
      const { g, s } = n;
      const plain = (style: { fill: Fill; blend?: BlendMode; erase?: boolean }): void => {
        if (g.k === "rect") v.rect(g.x, g.y, g.w, g.h, style);
        else if (g.k === "circle") v.circle(g.x, g.y, g.r, style);
        else v.polygon(g.pts, style);
      };
      const fx = s.effects;
      if (fx === undefined) plain({ fill: s.fill, ...(s.blend === undefined ? {} : { blend: s.blend }), ...(s.erase === true ? { erase: true } : {}) });
      else if (s.erase === true) v.cache(`fx${cacheKey++}`, () => v.group({ effects: fx }, () => plain({ fill: s.fill })), { erase: true });
      else v.group({ effects: fx, ...(s.blend === undefined ? {} : { blend: s.blend }) }, () => plain({ fill: s.fill }));
    } else if (n.t === "group") {
      const run = (): void => v.group({ ...(n.opacity === undefined ? {} : { opacity: n.opacity }), ...(n.blend === undefined ? {} : { blend: n.blend }), ...(n.effects === undefined ? {} : { effects: n.effects }) }, () => drawToday(v, n.body));
      if (n.clip === undefined) run();
      else v.clip(n.clip, run);
    } else if (n.t === "clip") v.clip(n.shapes, () => drawToday(v, n.body));
    else v.mask(() => drawToday(v, n.mask), () => drawToday(v, n.body));
  }
}

// The statues and the one visitor, painted with brushes and lit from the west like
// the room. Statues are citizens in sandstone worn faceless: soft outlines, no
// features, dust on every upward surface.
import type { BrushPreset, Vec2, View } from "@ianbicking/canvas-loop";
import { CX, CY, type Figure, SQ, hash, rimPoint, wallShadow } from "./room-tea.js";

interface Palette { shadow: string; mid: string; light: string; glint: string; dust: string; pit: string }
/** In the sun, and in the west wall's shadow, where only the purple sky lights them. */
const SUNLIT: Palette = { shadow: "#5a3a48", mid: "#a8714f", light: "#e9a96f", glint: "#ffd7a0", dust: "#e6d6c0", pit: "#6e4636" };
const SHADED: Palette = { shadow: "#3a2a3e", mid: "#5f4656", light: "#7a5c6c", glint: "#8e6e7c", dust: "#8f8090", pit: "#3a2a3e" };
const GRAIN: BrushPreset = { preset: "bristle", lightJitter: 0.05, hueJitter: 4, load: 0.8 };
const CHALK: BrushPreset = { preset: "chalk", lightJitter: 0.04 };

export interface Statue extends Figure {
  pose: number;
  /** Mirror the pose. */
  flip: boolean;
  /** On the near side of the room: we see its back. */
  back: boolean;
  seed: number;
}

/** Where the statues stand: along the far wall between the arches, and a few on
 * the near side, seen from behind. Angles in fractions of π. */
export const STATUES: readonly Statue[] = [
  [-0.83, 140, 0], [-0.71, 150, 1], [-0.61, 136, 3], [-0.39, 146, 2], [-0.17, 138, 0],
  [0.16, 128, 3], [0.33, 124, 0], [0.67, 128, 2], [0.84, 132, 1],
].map(([a, h, pose], i): Statue => {
  const [x, y] = rimPoint((a ?? 0) * Math.PI, (a ?? 0) > 0 ? 70 : 38);
  return { x, y, h: h ?? 140, w: 17, pose: pose ?? 0, flip: i % 3 === 1, back: (a ?? 0) > 0, seed: i * 17 + 3 };
});

export const VISITOR: Figure = { x: CX - 150, y: 560, h: 50, w: 7 };

/** Shading across a part, lit from the west: warm light on the left, purple shade on the right. */
function sideLight(v: View, x0: number, x1: number, P: Palette): ReturnType<View["linearGradient"]> {
  return v.linearGradient(x0, 0, x1, 0, [[0, P.glint], [0.22, P.light], [0.55, P.mid], [1, P.shadow]]);
}

/** One statue on its plinth, drawn with its feet at (0, 0). Built from parts (robe,
 * arms, head) each shaded by the west light, with brushed folds and dust on top. */
function paintStatue(v: View, f: Statue): void {
  const h = f.h, sx = f.flip ? -1 : 1;
  const P = wallShadow(f.x - CX, (f.y - CY) * SQ) > 0.5 ? SHADED : SUNLIT;
  const pw = h * 0.22;
  // The plinth: a squat drum, lit on the west.
  v.rect(-pw, -6, pw * 2, 16, { fill: v.linearGradient(-pw, 0, pw, 0, [[0, P.light], [0.45, P.mid], [1, P.shadow]]) });
  v.ellipse(0, 10, pw, pw * 0.3, { fill: v.linearGradient(-pw, 0, pw, 0, [[0, P.mid], [1, P.shadow]]) });
  v.ellipse(0, -6, pw, pw * 0.3, { fill: P.light });
  for (let i = 0; i < 18; i++) {
    const a = hash(f.seed, i, 7) * Math.PI * 2, r = Math.sqrt(hash(f.seed, i, 8)) * pw * 0.95;
    v.circle(Math.cos(a) * r, -6 + Math.sin(a) * r * 0.3, 0.8, { fill: P.dust });
  }
  v.at({ translate: [0, -6] }, () => {
    const hood = f.pose === 2;
    // Robe: narrow at the shoulders, flaring a little to a curved hem.
    const robe: Vec2[] = [[-0.2 * h, 0], [-0.19 * h, -0.3 * h], [-0.165 * h, -0.55 * h], [-0.16 * h, -0.72 * h], [-0.08 * h, -0.78 * h], [0.08 * h, -0.78 * h], [0.16 * h, -0.72 * h], [0.165 * h, -0.55 * h], [0.19 * h, -0.3 * h], [0.2 * h, 0], [0, 0.025 * h]];
    v.curve(robe, true, { fill: sideLight(v, -0.2 * h, 0.2 * h, P) });
    v.clip(v.curvePath(robe, true), () => {
      // Folds falling from the waist: a shaded crease beside a lit ridge.
      for (let i = 0; i < 6; i++) {
        const x = (-0.15 + i * 0.06 + (hash(f.seed, i, 2) - 0.5) * 0.02) * h;
        const top = -(0.42 + hash(f.seed, i, 3) * 0.15) * h;
        v.curve([[x, top], [x + 0.01 * h, top * 0.5], [x - 0.005 * h, 0]], false, { stroke: x > 0.03 * h ? P.shadow : P.mid, weight: 0.03 * h, brush: { ...GRAIN, opacity: 0.55 }, gesture: { pressure: "taper-in" } });
        if (x < 0.08 * h) v.curve([[x - 0.022 * h, top + 6], [x - 0.012 * h, top * 0.5], [x - 0.026 * h, -2]], false, { stroke: P.glint, weight: 0.018 * h, brush: { ...GRAIN, opacity: 0.45 }, gesture: { pressure: "taper-in" } });
      }
      // The hem darkens where it meets the plinth.
      v.rect(-0.25 * h, -0.06 * h, 0.5 * h, 0.1 * h, { fill: v.linearGradient(0, -0.06 * h, 0, 0.03 * h, [[0, "rgba(60,30,40,0)"], [1, "rgba(60,30,40,0.55)"]]) });
    });
    // Arms: worn into the body, just a lit ridge each.
    const arm = (pts: Vec2[], width: number): void => {
      const xs = pts.map(([x]) => x);
      const lo = Math.min(...xs) - width, hi = Math.max(...xs) + width;
      v.path(v.tube(pts, { width, profile: [[0, 1], [1, 0.75]] }), { fill: sideLight(v, lo, hi, P) });
    };
    const shoulderL: Vec2 = [-0.15 * h * sx, -0.72 * h], shoulderR: Vec2 = [0.15 * h * sx, -0.72 * h];
    switch (f.pose % 4) {
      case 0:
        arm([shoulderL, [-0.19 * h * sx, -0.52 * h], [-0.17 * h * sx, -0.36 * h]], 0.075 * h);
        arm([shoulderR, [0.19 * h * sx, -0.52 * h], [0.17 * h * sx, -0.36 * h]], 0.075 * h);
        break;
      case 1:
        arm([shoulderL, [-0.19 * h * sx, -0.52 * h], [-0.17 * h * sx, -0.36 * h]], 0.075 * h);
        arm([shoulderR, [0.21 * h * sx, -0.88 * h], [0.19 * h * sx, -1.08 * h]], 0.07 * h);
        // What the hand held, worn to a stump.
        v.roundRect(0.17 * h * sx - 0.025 * h, -1.2 * h, 0.05 * h, 0.12 * h, 0.02 * h, { fill: sideLight(v, 0.14 * h * sx, 0.22 * h * sx, P) });
        break;
      case 2:
        arm([shoulderL, [-0.12 * h * sx, -0.55 * h], [0, -0.48 * h]], 0.075 * h);
        arm([shoulderR, [0.12 * h * sx, -0.55 * h], [0.01 * h, -0.5 * h]], 0.075 * h);
        break;
      default:
        arm([shoulderL, [-0.18 * h * sx, -0.58 * h], [-0.04 * h * sx, -0.46 * h]], 0.075 * h);
        arm([shoulderR, [0.18 * h * sx, -0.58 * h], [0.04 * h * sx, -0.47 * h]], 0.075 * h);
        v.ellipse(0, -0.46 * h, 0.06 * h, 0.04 * h, { fill: sideLight(v, -0.06 * h, 0.06 * h, P) });
    }
    // Neck and head: an egg with no face, lit on the upper left.
    const hx = hood ? 0.02 * h * sx : 0, hy = hood ? -0.86 * h : -0.89 * h;
    v.rect(-0.035 * h, -0.84 * h, 0.07 * h, 0.08 * h, { fill: sideLight(v, -0.035 * h, 0.035 * h, P) });
    if (hood) {
      const cowl: Vec2[] = [[-0.12 * h, -0.74 * h], [-0.11 * h, -0.88 * h], [-0.04 * h + hx, -0.97 * h], [0.06 * h + hx, -0.95 * h], [0.12 * h, -0.84 * h], [0.13 * h, -0.74 * h]];
      v.curve(cowl, true, { fill: sideLight(v, -0.12 * h, 0.13 * h, P) });
      if (!f.back) v.ellipse(hx + 0.02 * h * sx, -0.85 * h, 0.045 * h, 0.06 * h, { fill: P.shadow });
    } else {
      v.ellipse(hx, hy, 0.068 * h, 0.088 * h, { fill: v.radialGradient(hx - 0.03 * h, hy - 0.035 * h, 0.12 * h, [[0, P.glint], [0.35, P.light], [0.75, P.mid], [1, P.shadow]]) });
    }
    // Dust: pale chalk on every upward surface.
    const dust = (x: number, y: number, w: number): void => {
      v.line(x - w, y + 0.006 * h, x + w, y + 0.006 * h, { stroke: P.dust, weight: 0.012 * h, brush: { ...CHALK, opacity: 0.7 }, gesture: { pressure: "taper" } });
    };
    dust(-0.12 * h, -0.78 * h, 0.04 * h);
    dust(0.1 * h, -0.78 * h, 0.035 * h);
    dust(hx - 0.01 * h, hood ? -0.955 * h : -0.97 * h, 0.035 * h);
    if (f.pose % 4 === 1) dust(0.17 * h * sx, -1.2 * h, 0.02 * h);
    // A chip or two.
    v.line(0.05 * h, -0.4 * h, 0.08 * h, -0.36 * h, { stroke: P.pit, weight: 0.8 });
  });
}

/** The visitor: a small figure in a dark coat, looking up at the statues. */
function paintVisitor(v: View, f: Figure): void {
  const h = f.h;
  const coat: Vec2[] = [[-6, 0], [-7, -h * 0.4], [-8, -h * 0.66], [-5, -h * 0.74], [5, -h * 0.74], [8, -h * 0.66], [7, -h * 0.4], [6, 0]];
  v.curve(coat, true, { fill: "#2a2d45" });
  v.clip(v.curvePath(coat, true), () => {
    v.curve(coat.map(([x, y]): Vec2 => [x - 4, y]), true, { fill: "#46507a" });
    v.line(-6, -h * 0.7, -6, -4, { stroke: "#e2955c", weight: 1.6, brush: GRAIN, gesture: { pressure: "taper" } });
  });
  v.circle(0, -h * 0.84, 5, { fill: "#7a4c3a" });
  v.circle(-1.5, -h * 0.85, 4.2, { fill: "#d8956a" });
  v.path([["move", -5, -h * 0.86], ["quad", -1, -h * 0.98, 5, -h * 0.87], ["line", 5, -h * 0.82], ["quad", 1, -h * 0.9, -5, -h * 0.82], ["close"]], { fill: "#2a1b1b" });
}

/** Statues and visitor, back to front, each a sprite painted once. */
export function paintFigures(v: View): void {
  const all: { y: number; draw: () => void }[] = [
    ...STATUES.map((f) => ({
      y: f.y,
      draw: () => {
        const w = Math.ceil(f.h * 0.7 + 40), h = Math.ceil(f.h * 1.35 + 30);
        const sp = v.picture({ key: `statue-${f.seed}`, width: w, height: h }, () => v.at({ translate: [w / 2, h - 16] }, () => paintStatue(v, f)));
        v.place(sp, f.x - w / 2, f.y - (h - 16));
      },
    })),
    { y: VISITOR.y, draw: () => v.at({ translate: [VISITOR.x, VISITOR.y] }, () => paintVisitor(v, VISITOR)) },
  ];
  for (const item of all.toSorted((p, q) => p.y - q.y)) item.draw();
}

/** Dust motes drifting in the light. */
export function paintMotes(v: View, t: number): void {
  for (let i = 0; i < 70; i++) {
    const x0 = 140 + hash(i, 0, 61) * 920, y0 = 120 + hash(i, 0, 62) * 600;
    const x = x0 + Math.sin(t * 0.004 + i) * 22 + t * 0.03;
    const y = y0 + Math.cos(t * 0.003 + i * 1.7) * 14 - t * 0.015;
    const tw = 0.35 + 0.65 * Math.max(0, Math.sin(t * 0.03 + i * 2.1));
    v.circle(((x % 1200) + 1200) % 1200, ((y % 860) + 860) % 860, 0.9 + hash(i, 0, 63), { fill: `rgba(255,214,160,${(tw * 0.55).toFixed(3)})` });
  }
}

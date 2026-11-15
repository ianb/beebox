// Ground painters. Every mark a cell makes depends only on that cell, its eight
// neighbours, the hash of its position and the frame. So the same painters can
// paint the whole map at once, or paint one cell at a time clipped to its square
// (drawing the marks of its neighbours too): both give the same pixels, and the
// per-cell version is a tile that could be baked into an atlas.
import type { SceneStyle as Style, SceneView as View } from "@ianbicking/canvas-loop";
import { type Ground, PERIOD, S, groundAt, hash, wind } from "./map-tea.js";
import { LEAVES, foliage } from "./paint-tea.js";

/** One painting pass over a cell. Passes run in order over every cell, so a later
 * pass of one cell covers an earlier pass of its neighbour. */
export interface Pass {
  name: string;
  /** Whether the pass moves with the frame (static passes are cached). */
  animated: boolean;
  /** Which ground styles use it; all when left out. */
  styles?: readonly GroundStyle[];
  paint: (v: View, c: { x: number; y: number; t: number }) => void;
}

const HALF = S / 2;

export type GroundStyle = "painted cells" | "brushed paths" | "field";
const isGrassy = (g: Ground): boolean => g === "grass" || g === "flowers";

/** The union shape of a region (path, water, soil, forest) at one cell, filled with
 * `style`, its edge `inset` px in from the cell's border where the region ends.
 * Pieces: a round blob at the centre, bridges east and south to the same kind,
 * a filled square where four cells meet, and small lobes along open edges so the
 * shore is not a geometric curve. */
function regionPiece(v: View, a: { x: number; y: number; kind: Ground; inset: number; style: Style; lobes?: number }): void {
  const { x, y, kind, inset, style } = a;
  if (groundAt(x, y) !== kind) return;
  const px = x * S, py = y * S;
  const r = HALF - inset;
  if (r > 0) v.circle(px + HALF, py + HALF, r, style);
  const e = groundAt(x + 1, y) === kind, s = groundAt(x, y + 1) === kind;
  if (e) v.rect(px + HALF, py + inset, S, S - 2 * inset, style);
  if (s) v.rect(px + inset, py + HALF, S - 2 * inset, S, style);
  if (e && s && groundAt(x + 1, y + 1) === kind) v.rect(px + HALF, py + HALF, S, S, style);
  // Round each inside corner: where the region turns around a missing diagonal
  // neighbour, fill a curved fillet into the corner the bridges leave square.
  const f = 5 + Math.max(0, inset) * 0.6;
  for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    if (groundAt(x + dx, y) !== kind || groundAt(x, y + dy) !== kind || groundAt(x + dx, y + dy) === kind) continue;
    const cx = px + HALF + dx * (HALF - inset), cy = py + HALF + dy * (HALF - inset);
    v.path([["move", cx, cy], ["line", cx + dx * f, cy], ["quad", cx, cy, cx, cy + dy * f], ["close"]], style);
  }
  const lobes = a.lobes ?? 0;
  if (lobes === 0) return;
  // Lobes on each side that the region does not continue across.
  const sides: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (const [side, [dx, dy]] of sides.entries()) {
    if (groundAt(x + dx, y + dy) === kind) continue;
    for (let i = 0; i < lobes; i++) {
      const along = (hash(x, y, 10 + side * 7 + i) - 0.5) * (S - 2 * inset - 6);
      const lr = 3 + hash(x, y, 40 + side * 7 + i) * 4;
      const out = HALF - inset - lr * 0.4 + (hash(x, y, 70 + side * 7 + i) - 0.3) * 3;
      const cx = px + HALF + dx * out + (dy !== 0 ? along : 0);
      const cy = py + HALF + dy * out + (dx !== 0 ? along : 0);
      v.circle(cx, cy, lr, style);
    }
  }
}

/** A tapered blade from (bx, by), `h` tall, its tip pushed `lean` px sideways. */
function blade(v: View, a: { bx: number; by: number; h: number; lean: number; w: number; fill: string }): void {
  const { bx, by, h, lean, w } = a;
  const tx = bx + lean, ty = by - h;
  v.path(
    [
      ["move", bx - w, by],
      ["quad", bx - w * 0.3 + lean * 0.2, by - h * 0.55, tx, ty],
      ["quad", bx + w * 0.4 + lean * 0.25, by - h * 0.5, bx + w, by],
      ["close"],
    ],
    { fill: a.fill },
  );
}

const GRASS_BASE = "#5f9a3e";
const GRASS_MOTTLE = ["#6aa845", "#55893a", "#73b04b", "#4f8236"];
const BLADE = ["#4c8233", "#6fae47", "#86c158", "#3f7330"];
const TALL = ["#4f8f30", "#66a33a", "#80b445", "#3f7a2a", "#a3bd58"];
const FLOWER = ["#f2e6a8", "#e88a8a", "#f4f0ee", "#c9a0e8", "#f3c35d"];

const grassBase: Pass = {
  name: "grass",
  animated: false,
  paint: (v, { x, y }) => {
    // Soft patches of lighter and darker grass, a little larger than a cell, so the
    // field has a slow colour drift instead of a repeating tile.
    for (let i = 0; i < 3; i++) {
      const cx = x * S + hash(x, y, i) * S, cy = y * S + hash(x, y, i + 3) * S;
      const r = 14 + hash(x, y, i + 6) * 14;
      const col = GRASS_MOTTLE[Math.floor(hash(x, y, i + 9) * GRASS_MOTTLE.length)] ?? GRASS_BASE;
      v.circle(cx, cy, r, { fill: v.radialGradient(cx, cy, r, [[0, `${col}aa`], [1, `${col}00`]]) });
    }
    // Small dark specks of earth and clover.
    for (let i = 0; i < 4; i++) {
      const cx = x * S + hash(x, y, 20 + i) * S, cy = y * S + hash(x, y, 30 + i) * S;
      v.ellipse(cx, cy, 1.4, 0.9, { fill: hash(x, y, 40 + i) < 0.5 ? "#4a7a31" : "#7cb653" });
    }
  },
};

/** One fill layer of a region, as its own pass: so every cell's edge layer is down
 * before any cell's fill covers it, and the region reads as one shape. */
function layer(a: { kind: Ground; inset: number; fill: string; lobes?: number }): Pass {
  return {
    name: `${a.kind}-${a.inset}`,
    animated: false,
    paint: (v, { x, y }) => regionPiece(v, { x, y, kind: a.kind, inset: a.inset, style: { fill: a.fill }, lobes: a.lobes ?? 0 }),
  };
}

const furrows: Pass = {
  name: "furrows",
  animated: false,
  paint: (v, { x, y }) => {
    if (groundAt(x, y) !== "soil") return;
    // Furrows: a dark trench and a light ridge per crop row.
    const px = x * S, py = y * S;
    const left = groundAt(x - 1, y) === "soil" ? px : px + 4, right = groundAt(x + 1, y) === "soil" ? px + S : px + S - 4;
    for (const fy of [py + 9, py + 25]) {
      v.line(left, fy, right, fy, { stroke: "#4a3020", weight: 3 });
      v.line(left, fy - 3, right, fy - 3, { stroke: "#8d6448", weight: 1.5 });
    }
    for (let i = 0; i < 5; i++) {
      v.circle(px + 3 + hash(x, y, 50 + i) * (S - 6), py + 3 + hash(x, y, 60 + i) * (S - 6), 0.9, { fill: "#a07a5a" });
    }
  },
};

const pathTexture: Pass = {
  name: "path-texture",
  animated: false,
  paint: (v, { x, y }) => {
    if (groundAt(x, y) !== "path") return;
    const px = x * S, py = y * S;
    // A lighter worn line down the middle, then pebbles.
    v.circle(px + HALF, py + HALF, 7, { fill: v.radialGradient(px + HALF, py + HALF, 9, [[0, "#d9b98299"], [1, "#d9b98200"]]) });
    for (let i = 0; i < 7; i++) {
      const cx = px + 7 + hash(x, y, 80 + i) * (S - 14), cy = py + 7 + hash(x, y, 90 + i) * (S - 14);
      const r = 0.8 + hash(x, y, 100 + i) * 1.6;
      v.ellipse(cx, cy + 0.6, r, r * 0.7, { fill: "#8a6a46" });
      v.ellipse(cx, cy, r, r * 0.7, { fill: hash(x, y, 110 + i) < 0.5 ? "#e0c79a" : "#a98b66" });
    }
  },
};

/** Ripples drift east and sparkles blink, each on whole cycles of PERIOD. */
const waterMotion: Pass = {
  name: "water-motion",
  animated: true,
  paint: (v, { x, y, t }) => {
    if (groundAt(x, y) !== "water") return;
    const px = x * S, py = y * S;
    const a = (2 * Math.PI * t) / PERIOD;
    for (let i = 0; i < 2; i++) {
      const phase = hash(x, y, 120 + i) * Math.PI * 2;
      const cx = px + 8 + hash(x, y, 130 + i) * 16 + Math.sin(a + phase) * 3;
      const cy = py + 8 + hash(x, y, 140 + i) * 16;
      const len = 4 + hash(x, y, 150 + i) * 4;
      const alpha = 0.25 + 0.25 * Math.sin(a + phase);
      v.path([["move", cx - len, cy], ["quad", cx, cy - 1.5, cx + len, cy]], { stroke: `rgba(220, 240, 250, ${alpha.toFixed(3)})`, weight: 1 });
    }
    const sp = hash(x, y, 160);
    const glint = Math.max(0, Math.sin(2 * a + sp * Math.PI * 2)) ** 12;
    if (glint > 0.05) {
      const gx = px + 6 + hash(x, y, 170) * 20, gy = py + 6 + hash(x, y, 180) * 20;
      v.line(gx - 2.5 * glint, gy, gx + 2.5 * glint, gy, { stroke: `rgba(255,255,255,${glint.toFixed(3)})`, weight: 1 });
      v.line(gx, gy - 1.5 * glint, gx, gy + 1.5 * glint, { stroke: `rgba(255,255,255,${glint.toFixed(3)})`, weight: 1 });
    }
  },
};

const grassBlades: Pass = {
  name: "grass-blades",
  animated: true,
  paint: (v, { x, y, t }) => {
    const g = groundAt(x, y);
    if (!isGrassy(g)) return;
    for (let i = 0; i < 7; i++) {
      const bx = x * S + hash(x, y, 200 + i) * S, by = y * S + hash(x, y, 210 + i) * S;
      const sway = wind(bx, by, t) * 1.6;
      const n = 3 + Math.floor(hash(x, y, 220 + i) * 3);
      for (let j = 0; j < n; j++) {
        const fan = (j - (n - 1) / 2) * 1.6;
        const h = 3.5 + hash(x, y, 230 + i * 5 + j) * 3.5;
        const fill = BLADE[Math.floor(hash(x, y, 240 + i * 5 + j) * BLADE.length)] ?? "#4c8233";
        blade(v, { bx: bx + fan * 0.6, by, h, lean: fan + sway, w: 0.8, fill });
      }
    }
    if (g !== "flowers") return;
    for (let i = 0; i < 5; i++) {
      const fx = x * S + 3 + hash(x, y, 300 + i) * (S - 6), fy = y * S + 3 + hash(x, y, 310 + i) * (S - 6);
      const sway = wind(fx, fy, t) * 1.2;
      const col = FLOWER[Math.floor(hash(x, y, 320 + i) * FLOWER.length)] ?? "#fff";
      v.line(fx, fy, fx + sway, fy - 5, { stroke: "#4a7d30", weight: 0.8 });
      const hx = fx + sway, hy = fy - 5.5;
      for (let k = 0; k < 5; k++) {
        const ang = (k / 5) * Math.PI * 2 + hash(x, y, 330 + i);
        v.circle(hx + Math.cos(ang) * 1.3, hy + Math.sin(ang) * 1.3, 1.1, { fill: col });
      }
      v.circle(hx, hy, 0.8, { fill: "#e9b23a" });
    }
  },
};

/** Tall grass: dense, long blades that bow in the gusts. Clumps thin out toward
 * the patch's open edges so it fades into the meadow instead of stopping at a line. */
const tallGrass: Pass = {
  name: "tall-grass",
  animated: true,
  paint: (v, { x, y, t }) => {
    if (groundAt(x, y) !== "tall") return;
    for (let i = 0; i < 16; i++) {
      const u = hash(x, y, 400 + i), w = hash(x, y, 410 + i);
      const bx = x * S + u * S, by = y * S + 4 + w * (S - 2);
      // Distance into open sides, 0 at the border.
      const openW = groundAt(x - 1, y) !== "tall" ? u : 1, openE = groundAt(x + 1, y) !== "tall" ? 1 - u : 1;
      const openN = groundAt(x, y - 1) !== "tall" ? w : 1, openS = groundAt(x, y + 1) !== "tall" ? 1 - w : 1;
      const edge = Math.min(openW, openE, openN, openS);
      if (edge < 0.35 && hash(x, y, 420 + i) > edge * 2.4) continue;
      const scale = 0.6 + Math.min(1, edge * 2) * 0.4;
      const sway = wind(bx, by, t) * 5 * scale;
      for (let j = 0; j < 5; j++) {
        const fan = (j - 2) * 1.8;
        const h = (11 + hash(x, y, 430 + i * 5 + j) * 8) * scale;
        const fill = TALL[Math.floor(hash(x, y, 440 + i * 5 + j) * TALL.length)] ?? "#5e9a35";
        blade(v, { bx: bx + fan * 0.5, by, h, lean: fan + sway * (0.7 + j * 0.1), w: 1, fill });
      }
      if (hash(x, y, 450 + i) < 0.3) {
        // A seed head on a taller stalk.
        const sx = bx + sway * 1.2, sy = by - 20 * scale;
        v.line(bx, by, sx, sy, { stroke: "#9a9a4a", weight: 0.7 });
        v.ellipse(sx, sy - 2, 1.2, 2.6, { fill: "#d8c27a" });
      }
    }
  },
};

const FOREST_SHADE = "#21402a";

/** Trunks under the forest's southern edge, where the viewer sees under the canopy,
 * with the shade the canopy throws on the grass below. */
const forestTrunks: Pass = {
  name: "forest-trunks",
  animated: false,
  paint: (v, { x, y }) => {
    if (groundAt(x, y) !== "forest" || groundAt(x, y + 1) === "forest") return;
    const px = x * S, by = (y + 1) * S;
    v.ellipse(px + HALF, by + 2, HALF + 6, 7, { fill: v.ellipseGradient(px + HALF, by + 2, HALF + 6, 7, [[0, "rgba(15,30,15,0.45)"], [1, "rgba(15,30,15,0)"]]) });
    for (let i = 0; i < 2; i++) {
      const tx = px + 6 + hash(x, y, 580 + i) * (S - 12);
      const h = 8 + hash(x, y, 590 + i) * 5;
      v.rect(tx - 2.2, by - 8, 4.4, h, { fill: "#3b2a1c" });
      v.rect(tx - 2.2, by - 8, 1.4, h, { fill: "#5a412b" });
    }
  },
};

/** The canopy: painted leaf masses, two per cell, in two shades of forest green. */
const forestCrowns: Pass = {
  name: "forest-crowns",
  animated: false,
  paint: (v, { x, y }) => {
    if (groundAt(x, y) !== "forest") return;
    for (let i = 0; i < 2; i++) {
      const cx = x * S + 6 + hash(x, y, 500 + i) * (S - 12), cy = y * S + 4 + hash(x, y, 510 + i) * (S - 14);
      const r = 13 + hash(x, y, 520 + i) * 5;
      const look = LEAVES[hash(x, y, 530 + i) < 0.35 ? "oak" : "forest"];
      if (look) foliage(v, { cx, cy, r, look, x, y, salt: 40 + i * 7 });
    }
  },
};

/** Path segments as brush strokes: each cell strokes from its centre to the centres
 * of its east and south path neighbours, so the strokes run along the path and the
 * bristles streak in the direction of travel. */
function pathStroke(a: { name: string; weight: number; style: Style }): Pass {
  return {
    name: a.name,
    animated: false,
    styles: ["brushed paths"],
    paint: (v, { x, y }) => {
      if (groundAt(x, y) !== "path") return;
      const cx = x * S + HALF, cy = y * S + HALF;
      const style: Style = { ...a.style, weight: a.weight, gesture: { pressure: "even", wobble: 1.5, seed: Math.floor(hash(x, y, 1200) * 1e6) } };
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        if (groundAt(x + dx, y + dy) !== "path") continue;
        v.line(cx - dx * 3, cy - dy * 3, cx + dx * (S + 3), cy + dy * (S + 3), style);
      }
    },
  };
}

const only = (styles: readonly GroundStyle[], pass: Pass): Pass => ({ ...pass, styles });
const CELLS: GroundStyle[] = ["painted cells"];
const NOT_FIELD: GroundStyle[] = ["painted cells", "brushed paths"];

const PASSES: readonly Pass[] = [
  only(NOT_FIELD, grassBase),
  only(NOT_FIELD, layer({ kind: "soil", inset: 0, fill: "#5b3d27" })),
  only(NOT_FIELD, layer({ kind: "soil", inset: 2, fill: "#76513a" })),
  only(NOT_FIELD, furrows),
  only(CELLS, layer({ kind: "path", inset: 3, fill: "#86643f", lobes: 3 })),
  only(CELLS, layer({ kind: "path", inset: 5, fill: "#c9a46f", lobes: 2 })),
  only(["brushed paths"], layer({ kind: "path", inset: 4, fill: "#8a6842" })),
  only(["brushed paths"], layer({ kind: "path", inset: 6, fill: "#c29c66" })),
  pathStroke({ name: "path-edge", weight: 23, style: { stroke: "#9a7448", brush: { preset: "chalk", hueJitter: 6, lightJitter: 0.06 } } }),
  pathStroke({ name: "path-body", weight: 18, style: { stroke: "#c29c66", brush: { preset: "bristle", hueJitter: 6, lightJitter: 0.08 } } }),
  pathStroke({ name: "path-worn", weight: 8, style: { stroke: "#dcc08e", brush: { preset: "bristle", lightJitter: 0.06, load: 0.6 } } }),
  only(NOT_FIELD, pathTexture),
  only(NOT_FIELD, layer({ kind: "water", inset: -1, fill: "#8c7a52", lobes: 3 })),
  only(NOT_FIELD, layer({ kind: "water", inset: 3, fill: "#56684a", lobes: 3 })),
  only(NOT_FIELD, layer({ kind: "water", inset: 6, fill: "#4f9cb8", lobes: 3 })),
  only(NOT_FIELD, layer({ kind: "water", inset: 11, fill: "#3a80a6", lobes: 2 })),
  only(NOT_FIELD, layer({ kind: "water", inset: 14, fill: "#2c6a91", lobes: 2 })),
  waterMotion,
  grassBlades,
  tallGrass,
  only(NOT_FIELD, layer({ kind: "forest", inset: -2, fill: "#1b3322", lobes: 4 })),
  only(NOT_FIELD, layer({ kind: "forest", inset: 1, fill: FOREST_SHADE, lobes: 3 })),
  forestTrunks,
  forestCrowns,
];

export function passesFor(style: GroundStyle): readonly Pass[] {
  return PASSES.filter((p) => p.styles === undefined || p.styles.includes(style));
}

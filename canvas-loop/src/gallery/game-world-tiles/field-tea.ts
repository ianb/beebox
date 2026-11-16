// The ground as a field: every pixel's colour is a function of its world position.
//
// The ground is split into "dabs": small elongated patches on a jittered grid,
// like the strokes of a brush. Each dab looks up what the map is at its centre
// (grass, dirt, water, soil, forest floor) through smooth fields, and takes one
// colour. A pixel takes the colour of the nearest dab, measured along the dab's
// direction, so edges between materials are made of whole dabs and look ragged
// the way paint does, instead of following the cell grid.
//
// Because the colour depends only on position, any rectangle of the map can be
// computed on its own: a tile is just the field over its square.
import type { View } from "@ianbicking/canvas-loop";
import { type Ground, H, S, W, groundAt, hash } from "./map-tea.js";
import { ZOOM } from "./paint-tea.js";

/** Dab grid spacing, in map pixels. */
const DAB = 5;
const HALF = S / 2;

// --- Noise ---------------------------------------------------------------------

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
/** Value noise in 0..1 with a lattice step of `scale` px. */
function noise(x: number, y: number, scale: number, salt: number): number {
  const gx = x / scale, gy = y / scale;
  const ix = Math.floor(gx), iy = Math.floor(gy);
  const fx = smooth(gx - ix), fy = smooth(gy - iy);
  const a = hash(ix, iy, salt), b = hash(ix + 1, iy, salt), c = hash(ix, iy + 1, salt), d = hash(ix + 1, iy + 1, salt);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x: number, y: number, scale: number, salt: number): number {
  return (noise(x, y, scale, salt) * 4 + noise(x, y, scale / 2, salt + 1) * 2 + noise(x, y, scale / 4, salt + 2)) / 7;
}

// --- Fields from the map ---------------------------------------------------------

/** How much the cells around (x, y) are `kind`, blurred with a Gaussian about half a
 * cell wide: 0.5 on a straight edge between cells, rounded at corners, rising
 * toward 1 deep inside a region. */
function occupancy(x: number, y: number, kind: Ground): number {
  const cx = Math.floor(x / S), cy = Math.floor(y / S);
  let sum = 0, total = 0;
  for (let j = cy - 2; j <= cy + 2; j++) {
    for (let i = cx - 2; i <= cx + 2; i++) {
      const dx = x - (i * S + HALF), dy = y - (j * S + HALF);
      const w = Math.exp(-(dx * dx + dy * dy) / (2 * 15 * 15));
      total += w;
      if (groundAt(i, j) === kind) sum += w;
    }
  }
  return sum / total;
}

function segmentDistance(px: number, py: number, s: readonly [number, number, number, number]): { d: number; angle: number } {
  const [ax, ay, bx, by] = s;
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  const dx = px - (ax + vx * t), dy = py - (ay + vy * t);
  return { d: Math.hypot(dx, dy), angle: len2 === 0 ? 0 : Math.atan2(vy, vx) };
}

/** Distance from (x, y) to the path's centre line (segments between the centres of
 * neighbouring path cells), and the direction of the nearest segment. */
function pathDistance(x: number, y: number): { d: number; angle: number } {
  const cx = Math.floor(x / S), cy = Math.floor(y / S);
  let best = { d: Infinity, angle: 0 };
  for (let j = cy - 2; j <= cy + 1; j++) {
    for (let i = cx - 2; i <= cx + 1; i++) {
      if (groundAt(i, j) !== "path") continue;
      const ax = i * S + HALF, ay = j * S + HALF;
      const segs: [number, number, number, number][] = [[ax, ay, ax, ay]];
      if (groundAt(i + 1, j) === "path") segs.push([ax, ay, ax + S, ay]);
      if (groundAt(i, j + 1) === "path") segs.push([ax, ay, ax, ay + S]);
      for (const s of segs) {
        const r = segmentDistance(x, y, s);
        if (r.d < best.d) best = r;
      }
    }
  }
  return best;
}

// --- Colour ----------------------------------------------------------------------

type RGB = readonly [number, number, number];
function hex(h: string): RGB {
  const n = Number.parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: RGB, b: RGB, t: number): RGB {
  const u = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}
function shade(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

const C = {
  grassDark: hex("#4d8534"), grass: hex("#62993f"), grassLight: hex("#82b356"), grassDry: hex("#a3b25a"),
  dirtEdge: hex("#8a6842"), dirt: hex("#c29c66"), dirtLight: hex("#dcc08e"), pebble: hex("#9a8466"), pebbleLight: hex("#d9c9a4"),
  mud: hex("#7d6c48"), shallow: hex("#5ea9bd"), water: hex("#3f86a8"), deep: hex("#255f86"),
  soil: hex("#6e4b33"), trench: hex("#4a3020"), ridge: hex("#8f6649"),
  forest: hex("#1c3522"),
};

interface Dab {
  x: number;
  y: number;
  /** Direction of the stroke, radians. */
  angle: number;
  /** Length over width. */
  aspect: number;
  rgb: RGB;
}

/** What one dab at (x, y) paints. */
function dabAt(x: number, y: number, i: number, j: number): Dab {
  const jitter = hash(i, j, 7) - 0.5;
  const n = fbm(x, y, 48, 11);
  const fine = hash(i, j, 3);
  const vary = 0.94 + fine * 0.12;
  const water = occupancy(x, y, "water") + (noise(x, y, 10, 21) - 0.5) * 0.12;
  if (water > 0.5) {
    const depth = (water - 0.5) * 2.2;
    const rgb = depth < 0.18 ? mix(C.shallow, C.water, depth / 0.18) : mix(C.water, C.deep, (depth - 0.18) / 0.6);
    return { x, y, angle: jitter * 0.3, aspect: 3, rgb: shade(rgb, 0.97 + fine * 0.06) };
  }
  if (water > 0.4) return { x, y, angle: hash(i, j, 5) * 3, aspect: 1.6, rgb: shade(C.mud, vary) };
  const forest = occupancy(x, y, "forest") + (noise(x, y, 12, 31) - 0.5) * 0.2;
  if (forest > 0.5) return { x, y, angle: hash(i, j, 5) * 3, aspect: 1.5, rgb: shade(C.forest, vary) };
  const path = pathDistance(x, y);
  const halfW = 12 + (noise(x, y, 14, 41) - 0.5) * 6;
  // Wide stretches (two cells side by side) fill in from the path's occupancy.
  const occ = occupancy(x, y, "path") + (noise(x, y, 14, 41) - 0.5) * 0.15;
  if (path.d < halfW || occ > 0.62) {
    const edge = Math.min(path.d / halfW, Math.max(0, (0.95 - occ) / 0.33));
    let rgb = edge > 0.78 ? C.dirtEdge : mix(C.dirtLight, C.dirt, smooth(Math.min(1, edge * 1.4 + (n - 0.5))));
    const pebble = hash(i, j, 9);
    if (edge < 0.8 && pebble < 0.05) rgb = pebble < 0.015 ? C.pebbleLight : C.pebble;
    return { x, y, angle: path.angle + jitter * 0.5, aspect: 2.4, rgb: shade(rgb, vary) };
  }
  const soil = occupancy(x, y, "soil") + (noise(x, y, 8, 51) - 0.5) * 0.1;
  if (soil > 0.5) {
    // Furrows on a 16 px repeat: a dark trench under each crop row, a ridge between.
    const row = Math.cos(((y - 9) / 16) * Math.PI * 2);
    const rgb = row > 0.55 ? C.trench : row < -0.3 ? C.ridge : C.soil;
    return { x, y, angle: jitter * 0.25, aspect: 3, rgb: shade(rgb, vary) };
  }
  const tall = occupancy(x, y, "tall");
  let rgb = n < 0.42 ? mix(C.grassDark, C.grass, n / 0.42) : mix(C.grass, C.grassLight, (n - 0.42) / 0.4);
  rgb = mix(rgb, C.grassDry, tall * 0.5);
  // The meadow darkens a little toward the forest's shade.
  rgb = shade(rgb, 1 - Math.max(0, forest - 0.15) * 0.4);
  const angle = -0.9 + (noise(x, y, 60, 61) - 0.5) * 1.6 + jitter * 0.6;
  return { x, y, angle, aspect: 2.7, rgb: shade(rgb, vary) };
}

/** Every dab, computed once: the field never changes. Rows from -3 to cover the
 * map's edge. */
const MARGIN = 3;
const DW = Math.ceil((W * S) / DAB) + MARGIN * 2, DH = Math.ceil((H * S) / DAB) + MARGIN * 2;
const DABS: readonly Dab[] = Array.from({ length: DW * DH }, (_, k) => {
  const i = (k % DW) - MARGIN, j = Math.floor(k / DW) - MARGIN;
  const x = (i + 0.2 + hash(i, j, 1) * 0.6) * DAB, y = (j + 0.2 + hash(i, j, 2) * 0.6) * DAB;
  return dabAt(x, y, i, j);
});
function dab(i: number, j: number): Dab | undefined {
  return DABS[(j + MARGIN) * DW + i + MARGIN];
}

/** The colour of a world point: the nearest dab by stretched distance, blended into
 * the second nearest across a narrow border so dabs overlap softly, with faint
 * streaks across each dab like the bristles of a brush. */
function colourAt(x: number, y: number): RGB {
  const ci = Math.floor(x / DAB), cj = Math.floor(y / DAB);
  let best: Dab | undefined, second: Dab | undefined, d1 = Infinity, d2 = Infinity, across1 = 0;
  for (let j = cj - 2; j <= cj + 2; j++) {
    for (let i = ci - 2; i <= ci + 2; i++) {
      const d = dab(i, j);
      if (!d) continue;
      const dx = x - d.x, dy = y - d.y;
      const c = Math.cos(d.angle), s = Math.sin(d.angle);
      const along = (dx * c + dy * s) / d.aspect, across = -dx * s + dy * c;
      const dist = along * along + across * across;
      if (dist < d1) {
        second = best;
        d2 = d1;
        best = d;
        d1 = dist;
        across1 = across;
      } else if (dist < d2) {
        second = d;
        d2 = dist;
      }
    }
  }
  if (!best) return C.grass;
  const streak = 1 + 0.05 * Math.sin(across1 * 2.6 + best.x * 1.7);
  const own = shade(best.rgb, streak);
  if (!second) return own;
  const gap = Math.sqrt(d2) - Math.sqrt(d1);
  return mix(second.rgb, own, 0.5 + 0.5 * smooth(Math.min(1, gap / 1.1)));
}

/** Paints the field over a rectangle of the map (map pixels) as an image of
 * computed pixels at the map's zoom. Port (scene core chunk 5):
 * `putImageData` at device resolution became `v.pixels`, placed under the
 * inverse scale so one image pixel is one canvas pixel (draft decision 12). */
export function paintField(v: View, rect: { x: number; y: number; w: number; h: number }): void {
  // The map is drawn at ZOOM (a picture body cannot ask where it is placed).
  const k = ZOOM;
  const dw = Math.round(rect.w * k), dh = Math.round(rect.h * k);
  const field = v.pixels({ key: `field-${rect.x}-${rect.y}-${rect.w}-${rect.h}-${k}`, width: dw, height: dh }, (img) => {
    const px = img.data;
    for (let j = 0; j < dh; j++) {
      for (let i = 0; i < dw; i++) {
        const [r, g, b] = colourAt(rect.x + (i + 0.5) / k, rect.y + (j + 0.5) / k);
        const o = (j * dw + i) * 4;
        px[o] = r;
        px[o + 1] = g;
        px[o + 2] = b;
        px[o + 3] = 255;
      }
    }
  });
  v.at({ scale: 1 / k }, () => v.place(field, Math.round(rect.x * k), Math.round(rect.y * k)));
}

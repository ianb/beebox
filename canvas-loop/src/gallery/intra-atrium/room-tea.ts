// The Hollow Atrium, lit by its frozen sunset: floor, walls and light computed per pixel.
//
// The room is a rotunda seen from above and in front. Its floor is a superellipse;
// the far half of its wall rises tall (the atrium's high ceiling), the near half is
// cut down to a parapet so the room stays in view. The sky screen overhead shows a
// sunset frozen low in the west, so the key light is warm and raking from the west:
// the east wall glows, the west wall throws a band of shadow on the floor, and every
// statue throws a long shadow east. Everything else is lit by the purple of the
// upper sky.
import type { View } from "@ianbicking/canvas-loop";

export const W = 1200;
export const H = 860;
export const CX = 600;
export const CY = 520;
export const RX = 500;
export const RY = 270;
const N = 2.5;
/** Height of the far wall, px. */
export const WALL = 175;
const THICK = 12;

/** World coordinates: screen x, and screen y stretched back to a round plan. */
export const SQ = RX / RY;

// --- Helpers -------------------------------------------------------------------------

export function hash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 2147483587);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function smooth(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}
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

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const n = Number.parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const mix = (a: RGB, b: RGB, t: number): RGB => {
  const u = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
};
const mul = (a: RGB, b: RGB): RGB => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const add = (a: RGB, b: RGB): RGB => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

// --- Light ---------------------------------------------------------------------------

/** Toward the frozen sun, in the plan (unit): west, a little north. */
const SUN: [number, number] = [-0.93, -0.36];
/** How far a shadow reaches per px of height: the sun is low. */
const SHADOW_LEN = 2.3;
const KEY: RGB = [1.25, 0.72, 0.38];
const AMBIENT: RGB = [0.36, 0.27, 0.46];

// --- Shape ---------------------------------------------------------------------------

/** 0 at the centre, 1 on the rim. */
function rimness(dx: number, dy: number): number {
  return (Math.abs(dx / RX) ** N + Math.abs(dy / RY) ** N) ** (1 / N);
}
/** Half the floor's screen height at horizontal offset dx. */
function rimHalf(dx: number, rx = RX, ry = RY): number {
  const t = Math.abs(dx / rx);
  return t >= 1 ? 0 : ry * (1 - t ** N) ** (1 / N);
}

/** Angle on the rim (back half is -π..0) for a horizontal offset. */
function backAngle(dx: number): number {
  const c = Math.sign(dx) * Math.abs(Math.max(-1, Math.min(1, dx / RX))) ** (N / 2);
  return -Math.acos(c);
}
/** A point on the rim at angle a, in screen px. */
export function rimPoint(a: number, inset = 0): [number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [CX + (RX - inset) * Math.sign(c) * Math.abs(c) ** (2 / N), CY + (RY - inset / SQ) * Math.sign(s) * Math.abs(s) ** (2 / N)];
}

/** Arc length along the rim from angle -π, so arches keep their width as the wall turns away. */
const ARC_STEPS = 2000;
const ARC: readonly number[] = (() => {
  const out = [0];
  let [px, py] = rimPoint(-Math.PI);
  for (let i = 1; i <= ARC_STEPS; i++) {
    const [x, y] = rimPoint(-Math.PI + (i / ARC_STEPS) * Math.PI);
    out.push((out[i - 1] ?? 0) + Math.hypot(x - px, (y - py) * SQ));
    px = x;
    py = y;
  }
  return out;
})();
function arcAt(a: number): number {
  const f = ((a + Math.PI) / Math.PI) * ARC_STEPS;
  const i = Math.max(0, Math.min(ARC_STEPS - 1, Math.floor(f)));
  const lo = ARC[i] ?? 0, hi = ARC[i + 1] ?? lo;
  return lo + (hi - lo) * (f - i);
}

/** Doorways in the far wall: angle, and the colour of the room beyond. */
export const ARCHES: readonly { a: number; glow: RGB; name: string }[] = [
  { a: -Math.PI * 0.5, glow: hex("#5fe0b0"), name: "Hallway" },
  { a: -Math.PI * 0.27, glow: hex("#5b8cff"), name: "Archive Lounge" },
  { a: -Math.PI * 0.07, glow: hex("#38d6f0"), name: "Activity Hub" },
  { a: -Math.PI * 0.92, glow: hex("#3fd69a"), name: "Intake Foyer" },
];
const ARCH_HALF = 34;
const ARCH_SPRING = 92;

// --- Statues and people, as shadow casters ------------------------------------------

export interface Figure {
  /** Feet, screen px. */
  x: number;
  y: number;
  /** Height, px. */
  h: number;
  /** Half width at the base, px. */
  w: number;
}

/** Shadow of a figure at a floor point: a soft, tapering band away from the sun. */
function figureShadow(f: Figure, wx: number, wy: number): number {
  const fx = f.x - CX, fy = (f.y - CY) * SQ;
  const rx = wx - fx, ry = wy - fy;
  const along = -(rx * SUN[0] + ry * SUN[1]);
  const len = f.h * SHADOW_LEN;
  if (along < -f.w || along > len + f.w * 2) return 0;
  const across = Math.abs(rx * -SUN[1] + ry * SUN[0]);
  const t = Math.max(0, along) / len;
  // Narrow at the feet, widest at the shoulders, a head at the end; softer as it goes.
  const half = f.w * (0.7 + 0.6 * Math.sin(Math.min(1, t * 1.2) * Math.PI * 0.85)) * (t > 0.86 ? 0.75 : 1);
  const soft = 2 + t * 14;
  const side = smooth((half + soft - across) / (soft * 2));
  const ends = smooth((along + f.w) / 6) * smooth((len + f.w - along) / (soft + 4));
  return side * ends * (0.92 - t * 0.35);
}

/** Shadow thrown by the west wall: the light ray toward the sun leaves the floor
 * over the wall before it has risen above the wall's height. */
export function wallShadow(wx: number, wy: number): number {
  const reach = WALL * SHADOW_LEN * 0.55;
  for (let s = 0; s <= reach; s += 2.5) {
    const px = wx + SUN[0] * s, py = wy + SUN[1] * s;
    if (rimness(px, py / SQ) >= 1) return 1 - smooth((s - reach * 0.45) / (reach * 0.55));
  }
  return 0;
}

// --- Floor ----------------------------------------------------------------------------

const STONE: RGB = hex("#d4a57a");
const STONE_DARK: RGB = hex("#a86a46");
const INLAY: RGB = hex("#8c3f26");
const INLAY_LIGHT: RGB = hex("#e6b77d");
const DUST: RGB = hex("#cdbba2");
const JOINT: RGB = hex("#5c3324");

/** Worn tracks: from each doorway toward the middle, where people walk. */
const TRACKS: readonly [number, number, number, number][] = [...ARCHES.map((a) => rimPoint(a.a, 30)), rimPoint(Math.PI * 0.5, 20)].map(([x, y]) => [x, (y - CY) * SQ, 0, 0]);
function wear(wx: number, wy: number): number {
  let best = 0;
  for (const [ax, ay] of TRACKS) {
    const vx = -ax, vy = -ay;
    const len2 = vx * vx + vy * vy;
    const t = Math.max(0, Math.min(1, ((wx - ax) * vx + (wy - ay) * vy) / len2));
    const d = Math.hypot(wx - (ax + vx * t), wy - (ay + vy * t));
    best = Math.max(best, 1 - smooth(d / (70 + t * 40)));
  }
  return best;
}

/** The footprints: one person's trail from the Foyer to where they stand. */
export const TRAIL: readonly [number, number][] = (() => {
  const [sx, sy] = rimPoint(-Math.PI * 0.92, 40);
  const ex = CX - 150, ey = CY + 40;
  const out: [number, number][] = [];
  const steps = 30;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const bend = Math.sin(t * Math.PI) * 50;
    out.push([sx + (ex - sx) * t, sy + (ey - sy) * t + bend * 0.5]);
  }
  return out;
})();
function footprint(x: number, y: number): number {
  for (const [i, [tx, ty]] of TRAIL.entries()) {
    const next = TRAIL[Math.min(TRAIL.length - 1, i + 1)] ?? [tx, ty];
    const ang = Math.atan2(next[1] - ty, next[0] - tx);
    const side = i % 2 === 0 ? 1 : -1;
    const fx = tx + Math.cos(ang + Math.PI / 2) * 4 * side, fy = ty + Math.sin(ang + Math.PI / 2) * 3 * side;
    const dx = x - fx, dy = y - fy;
    const u = dx * Math.cos(ang) + dy * Math.sin(ang), v = -dx * Math.sin(ang) + dy * Math.cos(ang);
    if ((u / 4.2) ** 2 + (v / 2.2) ** 2 < 1) return 1;
  }
  return 0;
}

function floorColour(x: number, y: number, figures: readonly Figure[]): RGB {
  const dx = x - CX, dy = y - CY;
  const wx = dx, wy = dy * SQ;
  const g = rimness(dx, dy);
  const r = Math.hypot(wx, wy);
  const ang = Math.atan2(wy, wx);
  let albedo: RGB;
  let polish = 0.6;
  if (g < 0.16) {
    // The sun mosaic at the centre: rays of dark and light stone, ringed.
    const rays = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 24);
    const ring = g / 0.16;
    albedo = ring > 0.88 ? INLAY : ring < 0.3 ? mix(INLAY_LIGHT, STONE, 0.2) : rays % 2 === 0 ? INLAY : INLAY_LIGHT;
    if (Math.abs(ring - 0.3) < 0.025 || Math.abs(ring - 0.88) < 0.02) albedo = JOINT;
    polish = 0.9;
  } else {
    // Rings of slabs, each cut into segments; every slab its own shade.
    const ringW = 0.105;
    const ring = Math.floor((g - 0.16) / ringW);
    const inRing = (g - 0.16) / ringW - ring;
    const segs = 10 + ring * 6;
    const seg = ((ang + Math.PI) / (Math.PI * 2)) * segs + ring * 0.37;
    const segI = Math.floor(seg);
    const tone = hash(ring, segI, 3);
    albedo = mix(STONE, STONE_DARK, tone * 0.45 + fbm(wx, wy, 120, 5) * 0.25);
    // Fine terrazzo grain.
    const grain = hash(Math.floor(x), Math.floor(y), 9);
    albedo = scale(albedo, 0.95 + grain * 0.08);
    const jointR = Math.min(inRing, 1 - inRing) * ringW * RX;
    const jointA = Math.min(seg - segI, 1 - seg + segI) * ((Math.PI * 2) / segs) * r;
    if (jointR < 1 || jointA < 0.9) albedo = mix(albedo, JOINT, 0.38);
    // A few cracks.
    const crack = Math.abs(noise(wx, wy, 26, 11) - 0.5);
    if (crack < 0.006 && fbm(wx, wy, 200, 12) > 0.72) albedo = mix(albedo, JOINT, 0.5);
  }
  // Dust settles along the walls and away from the tracks; footsteps clear it.
  const worn = wear(wx, wy);
  let dust = smooth((g - 0.5) / 0.38) * 0.95 + (fbm(wx, wy, 60, 21) - 0.5) * 0.5 - worn * 0.5;
  dust = Math.max(0, Math.min(1, dust));
  if (dust > 0.12 && footprint(x, y) > 0) dust *= 0.5;
  albedo = mix(albedo, DUST, dust * 0.75);
  polish *= (1 - dust) * (0.5 + worn * 0.6);

  // Light.
  let shade = wallShadow(wx, wy);
  for (const f of figures) shade = Math.max(shade, figureShadow(f, wx, wy));
  const screen = 0.75 + 0.35 * (1 - g * g);
  const key = (1 - shade) * screen;
  // Ambient occlusion where floor meets wall.
  const ao = 1 - smooth((g - 0.9) / 0.1) * 0.45;
  let c = mul(albedo, add(scale(AMBIENT, ao), scale(KEY, key * 0.85)));
  // The screen's sunset reflected in the polish: a long warm glow west of centre.
  const rx = (wx + 140) / 260, ry = (wy - 20) / 520;
  const sheen = Math.exp(-(rx * rx + ry * ry) * 2.2) * polish;
  c = add(c, scale([1, 0.62, 0.32], sheen * 0.28));
  return c;
}

// --- Walls ----------------------------------------------------------------------------

const PLASTER: RGB = hex("#c99068");
const CORNICE: RGB = hex("#e2b48a");
const RIM_TOP: RGB = hex("#3a2630");

function wallColour(x: number, h: number): RGB {
  const dx = x - CX;
  const a = backAngle(dx);
  const u = arcAt(a);
  // Inward normal, in the plan; walls facing the sun are lit.
  const c = Math.cos(a), s = Math.sin(a);
  const nx = -Math.sign(c) * Math.abs(c) ** (N - 1 - 0.0), ny = -Math.sign(s) * Math.abs(s) ** (N - 1);
  const nl = Math.hypot(nx, ny) || 1;
  const facing = Math.max(0, (nx * SUN[0] + ny * SUN[1]) / nl);
  // Arches.
  for (const arch of ARCHES) {
    const du = u - arcAt(arch.a);
    const inside = Math.abs(du) < ARCH_HALF && (h < ARCH_SPRING || Math.hypot(du, h - ARCH_SPRING) < ARCH_HALF);
    const frame = Math.abs(du) < ARCH_HALF + 7 && (h < ARCH_SPRING + 7 || Math.hypot(du, h - ARCH_SPRING) < ARCH_HALF + 7);
    if (inside) {
      // The passage beyond: dark, with the next room's light low and far.
      const depth = h / (ARCH_SPRING + ARCH_HALF);
      const glow = Math.exp(-((du / 26) ** 2)) * (1 - smooth(depth * 1.6));
      return add(scale(hex("#1a1020"), 1), scale(arch.glow, glow * 0.75));
    }
    if (frame) {
      const key = Math.hypot(du, h - ARCH_SPRING) < 8 && h > ARCH_SPRING + ARCH_HALF - 2;
      const stone = key ? CORNICE : mix(CORNICE, PLASTER, 0.3);
      return mul(stone, add(AMBIENT, scale(KEY, 0.25 + facing * 0.85)));
    }
  }
  let albedo = PLASTER;
  // Courses of stone, pilasters between bays, a cornice under the screen.
  const course = h % 24;
  const bay = ((u % 150) + 150) % 150;
  const pilaster = bay < 22;
  if (pilaster) albedo = mix(albedo, CORNICE, 0.45);
  else if (course < 1.2) albedo = scale(albedo, 0.8);
  if (pilaster && (bay < 2 || bay > 20)) albedo = scale(albedo, 0.75);
  if (h > WALL - 20 && h < WALL - 8) albedo = CORNICE;
  if (Math.abs(h - (WALL - 20)) < 1.2) albedo = scale(albedo, 0.6);
  albedo = scale(albedo, 0.92 + fbm(u, h, 40, 31) * 0.16);
  // Water stains running down from the cornice.
  const stain = noise(u, 0, 18, 41);
  if (stain > 0.72 && h > WALL - 20 - (stain - 0.72) * 300) albedo = scale(albedo, 0.86);
  const lift = 0.7 + 0.45 * (h / WALL);
  const ao = 0.6 + 0.4 * smooth(h / 26);
  let col = mul(albedo, add(scale(AMBIENT, ao * lift), scale(KEY, facing * 1.35 * lift)));
  // The edge of the sky screen glows along the top.
  if (h > WALL - 8) col = add(scale(col, 0.6), scale([1, 0.55, 0.35], (h - (WALL - 8)) / 8));
  return col;
}

// --- Assembly -------------------------------------------------------------------------

function rock(x: number, y: number): RGB {
  const n = fbm(x, y, 70, 51);
  return mix(hex("#140e15"), hex("#2a1d26"), n);
}

/** The colour of a screen pixel. */
function pixel(x: number, y: number, figures: readonly Figure[]): RGB {
  const dx = x - CX;
  const half = rimHalf(dx);
  const front = CY + half, back = CY - half;
  // The near parapet: cut low, seen from outside.
  if (half > 0 && y >= front - 6 && y < front + 18) {
    if (y < front + 2) return mul(hex("#d9a983"), add(AMBIENT, scale(KEY, 0.4)));
    return scale(mul(PLASTER, AMBIENT), 0.8 - ((y - front) / 18) * 0.3);
  }
  if (half > 0 && y > back && y < front - 6) return floorColour(x, y, figures);
  if (half > 0 && y <= back && y > back - WALL) return wallColour(x, back - y);
  // The wall's thickness on top of the far wall and around the ends.
  const outer = rimHalf(dx, RX + THICK, RY + THICK / SQ);
  if (outer > 0 && y <= CY - outer + 2 - WALL + THICK && y > CY - outer - WALL - 2) return RIM_TOP;
  if (outer > 0 && Math.abs(dx) > RX - 2 && y > CY - outer - WALL && y < CY + outer + 18) return RIM_TOP;
  if (half > 0 && y <= back - WALL && y > back - WALL - THICK) return RIM_TOP;
  return rock(x, y);
}

/** Paints the room as a fixed-resolution image of computed pixels. Port (scene
 * core chunk 5): `putImageData` at device resolution became `v.pixels`, W × H
 * pixels placed at the origin (draft decision 12). */
export function paintRoom(v: View, figures: readonly Figure[]): void {
  // Only figures standing in the sun cast a shadow: one inside the west wall's
  // shadow is lit by nothing the wall has not already blocked.
  const casters = figures.filter((f) => wallShadow(f.x - CX, (f.y - CY) * SQ) < 0.5);
  const room = v.pixels({ key: "atrium-room", width: W, height: H }, (img) => {
    const px = img.data;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const c = pixel(i + 0.5, j + 0.5, casters);
        const o = (j * W + i) * 4;
        // A gentle filmic curve keeps the hot light from clipping flat.
        px[o] = 255 * (1 - Math.exp(-c[0] * 1.6));
        px[o + 1] = 255 * (1 - Math.exp(-c[1] * 1.6));
        px[o + 2] = 255 * (1 - Math.exp(-c[2] * 1.6));
        px[o + 3] = 255;
      }
    }
  });
  v.place(room, 0, 0);
}

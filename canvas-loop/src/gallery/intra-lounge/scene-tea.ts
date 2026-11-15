// The Archive Lounge as a small 3D scene of boxes and spheres, rendered per pixel.
//
// The camera looks straight down the room from above its front edge, with the
// image shifted down (a shift lens): verticals stay vertical, and anything facing
// the camera, like the monitor screens, stays an undistorted rectangle. The front
// wall and the ceiling are cut away.
//
// The room is lit almost only by its screens, which change every frame. So the
// work is split. Once, for every pixel: what it is (albedo, emission), how much
// sky reaches it, and for every light how much of it arrives (angle, distance,
// the light's spread, and whether the sofa or the table is in the way). Each
// frame: multiply in each light's colour and brightness for that frame and sum.
// That is a deferred renderer with baked visibility, in plain code.
import type { View } from "@ianbicking/canvas-loop";

export const W = 1200;
export const H = 860;

// Room, metres: x across (-3..3), y up (0..3), z deep (0 front .. 5 back).
const RW = 3, RH = 3, RD = 5;

// An isometric camera: orthographic, looking down at 30 degrees from the front
// right corner, so a floor square draws as a 2:1 diamond. The far walls (back and
// left) stand full height; the near walls are cut down to parapets.
const ELEV = Math.PI / 6;
const DIR: readonly [number, number, number] = [-Math.SQRT1_2 * Math.cos(ELEV), -Math.sin(ELEV), Math.SQRT1_2 * Math.cos(ELEV)];
const RIGHT: readonly [number, number, number] = [Math.SQRT1_2, 0, Math.SQRT1_2];
/** The camera's up: perpendicular to its view and its right, pointing skyward. */
const UP: readonly [number, number, number] = [
  DIR[1] * RIGHT[2] - DIR[2] * RIGHT[1],
  DIR[2] * RIGHT[0] - DIR[0] * RIGHT[2],
  DIR[0] * RIGHT[1] - DIR[1] * RIGHT[0],
];
const dot = (a: readonly number[], b: readonly number[]): number => (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
/** Fit the room's corners to the canvas. */
const FIT = (() => {
  const corners: [number, number, number][] = [];
  for (const x of [-RW, RW]) for (const z of [0, RD]) for (const y of [0, RH]) corners.push([x, y, z]);
  const us = corners.map((c) => dot(c, RIGHT)), vs = corners.map((c) => dot(c, UP));
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  const s = Math.min((W - 60) / (u1 - u0), (H - 50) / (v1 - v0));
  return { s, ox: W / 2 - (s * (u0 + u1)) / 2, oy: H / 2 + (s * (v0 + v1)) / 2 };
})();
/** Screen px per metre. */
export const SCALE = FIT.s;

export function project(x: number, y: number, z: number): [number, number] {
  const p = [x, y, z];
  return [FIT.ox + SCALE * dot(p, RIGHT), FIT.oy - SCALE * dot(p, UP)];
}
/** Screen px per metre (the same everywhere: the view is orthographic). */
export function pxPerM(_z: number): number {
  return SCALE;
}
/** The canvas transform that maps a plane of constant z to the screen, with local
 * px coordinates: x right from world x0, y down from world y1. For drawing flat
 * pictures (a monitor's screen) onto the faces that look toward the viewer. */
export function faceTransform(x0: number, y1: number, z: number): [number, number, number, number, number, number] {
  const [e, f] = project(x0, y1, z);
  return [RIGHT[0], -UP[0], 0, UP[1], e, f];
}

// --- Helpers ---------------------------------------------------------------------------

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
function noise(x: number, y: number, s: number, salt: number): number {
  const gx = x / s, gy = y / s;
  const ix = Math.floor(gx), iy = Math.floor(gy);
  const fx = smooth(gx - ix), fy = smooth(gy - iy);
  const a = hash(ix, iy, salt), b = hash(ix + 1, iy, salt), c = hash(ix, iy + 1, salt), d = hash(ix + 1, iy + 1, salt);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x: number, y: number, s: number, salt: number): number {
  return (noise(x, y, s, salt) * 4 + noise(x, y, s / 2, salt + 1) * 2 + noise(x, y, s / 4, salt + 2)) / 7;
}
type RGB = [number, number, number];
export const hex = (h: string): RGB => {
  const n = Number.parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const mix = (a: RGB, b: RGB, t: number): RGB => {
  const u = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
};
const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

// --- Geometry ---------------------------------------------------------------------------

type Kind = "floor" | "wall" | "cap" | "crt" | "cabinet" | "board" | "vending" | "shelves" | "sofa" | "table" | "can" | "skin" | "sweater";
interface Box {
  kind: Kind;
  min: [number, number, number];
  max: [number, number, number];
  /** Casts shadows from the lights. */
  occludes?: boolean;
  id?: number;
}
interface Ball {
  kind: Kind;
  c: [number, number, number];
  r: number;
}

/** The monitors on the back wall: centre x, centre y, width, height, and what each shows. */
export type Show = "text" | "bars" | "scope" | "hex" | "roll" | "static" | "map";
export interface Crt {
  x: number;
  y: number;
  w: number;
  h: number;
  show: Show;
}
export const CRTS: readonly Crt[] = [
  // Bottom row, on the cabinet.
  { x: -2.35, y: 0.75, w: 0.8, h: 0.72, show: "text" },
  { x: -1.45, y: 0.72, w: 0.9, h: 0.68, show: "bars" },
  { x: -0.55, y: 0.78, w: 0.78, h: 0.78, show: "roll" },
  { x: 0.25, y: 0.72, w: 0.7, h: 0.66, show: "scope" },
  // Middle row, on a shelf.
  { x: -2.4, y: 1.6, w: 0.66, h: 0.56, show: "hex" },
  { x: -1.7, y: 1.64, w: 0.62, h: 0.62, show: "static" },
  { x: -0.95, y: 1.58, w: 0.78, h: 0.52, show: "text" },
  { x: -0.2, y: 1.62, w: 0.6, h: 0.6, show: "map" },
  { x: 0.4, y: 1.56, w: 0.48, h: 0.46, show: "bars" },
  // Top row, small sets.
  { x: -2.3, y: 2.32, w: 0.5, h: 0.44, show: "scope" },
  { x: -1.6, y: 2.3, w: 0.56, h: 0.42, show: "hex" },
  { x: -0.85, y: 2.34, w: 0.5, h: 0.46, show: "roll" },
  { x: -0.15, y: 2.3, w: 0.54, h: 0.42, show: "text" },
];
export const CRT_FRONT = 4.52;

/** The doorway to the Archive Console in the back wall, and to the Tranquil Pool on the right. */
export const CONSOLE_DOOR = { x0: 0.95, x1: 1.75, y1: 2.1 };
export const POOL_DOOR = { z0: 1.0, z1: 1.9, y1: 2.1 };
export const ATRIUM_DOOR = { x0: -0.5, x1: 0.4 };
/** Height of the cut-down near walls. */
const LOW = 0.3;
/** The vending machine, against the back wall in the right corner, facing the room. */
export const VENDING = { x0: 2.0, x1: 2.85, y1: 1.95, z0: 4.25, z1: RD };
/** Shelves of archive tapes along the left wall; their face is at x = SHELF_FACE. */
export const SHELF_FACE = -2.55;
export const SHELF = { y1: 2.4, z0: 0.6, z1: 3.6 };

const BOXES: readonly Box[] = [
  { kind: "floor", min: [-RW - 0.2, -0.2, -1], max: [RW + 0.2, 0, RD + 0.2] },
  // The far walls, full height.
  { kind: "wall", min: [-RW - 0.18, 0, -0.18], max: [-RW, RH, RD + 0.18] },
  { kind: "wall", min: [-RW - 0.18, 0, RD], max: [RW + 0.18, RH, RD + 0.18] },
  // The near walls, cut down, with a doorway to the Tranquil Pool and one to the Atrium.
  { kind: "wall", min: [RW, 0, -0.18], max: [RW + 0.18, LOW, POOL_DOOR.z0] },
  { kind: "wall", min: [RW, 0, POOL_DOOR.z1], max: [RW + 0.18, LOW, RD + 0.18] },
  { kind: "wall", min: [-RW - 0.18, 0, -0.18], max: [ATRIUM_DOOR.x0, LOW, 0] },
  { kind: "wall", min: [ATRIUM_DOOR.x1, 0, -0.18], max: [RW + 0.18, LOW, 0] },
  { kind: "cabinet", min: [-2.85, 0, 4.35], max: [0.7, 0.38, RD] },
  { kind: "board", min: [-2.85, 1.3, 4.35], max: [0.7, 1.34, RD] },
  { kind: "board", min: [-2.85, 2.06, 4.4], max: [0.7, 2.1, RD] },
  ...CRTS.map((c, i): Box => ({ kind: "crt", id: i, min: [c.x - c.w / 2, c.y - c.h / 2, CRT_FRONT], max: [c.x + c.w / 2, c.y + c.h / 2, RD] })),
  { kind: "vending", occludes: true, min: [VENDING.x0, 0, VENDING.z0], max: [VENDING.x1, VENDING.y1, VENDING.z1] },
  { kind: "shelves", min: [-RW, 0, SHELF.z0], max: [SHELF_FACE, SHELF.y1, SHELF.z1] },
  // The sofa, its back to us, facing the screens.
  { kind: "sofa", occludes: true, min: [-1.7, 0.08, 2.35], max: [0.7, 0.44, 3.15] },
  { kind: "sofa", occludes: true, min: [-1.7, 0.08, 2.05], max: [0.7, 0.98, 2.38] },
  { kind: "sofa", occludes: true, min: [-1.92, 0.08, 2.05], max: [-1.66, 0.66, 3.18] },
  { kind: "sofa", occludes: true, min: [0.66, 0.08, 2.05], max: [0.92, 0.66, 3.18] },
  // The coffee table, and what was left on it.
  { kind: "table", occludes: true, min: [-1.05, 0.38, 3.45], max: [0.15, 0.43, 3.98] },
  { kind: "table", min: [-1.0, 0, 3.5], max: [-0.95, 0.38, 3.55] },
  { kind: "table", min: [0.05, 0, 3.5], max: [0.1, 0.38, 3.55] },
  { kind: "table", min: [-1.0, 0, 3.88], max: [-0.95, 0.38, 3.93] },
  { kind: "table", min: [0.05, 0, 3.88], max: [0.1, 0.38, 3.93] },
  { kind: "can", occludes: true, min: [-0.7, 0.43, 3.62], max: [-0.63, 0.55, 3.69] },
  { kind: "can", occludes: true, min: [-0.2, 0.43, 3.7], max: [-0.13, 0.55, 3.77] },
  { kind: "can", occludes: true, min: [-0.45, 0.43, 3.8], max: [-0.36, 0.47, 3.89] },
];
/** Someone on the sofa, watching. */
const BALLS: readonly Ball[] = [
  { kind: "sweater", c: [-0.55, 0.82, 2.5], r: 0.25 },
  { kind: "skin", c: [-0.55, 1.12, 2.48], r: 0.13 },
];

interface Hit {
  s: number;
  n: [number, number, number];
  kind: Kind;
  id: number;
}

function rayBox(o: readonly number[], d: readonly number[], b: Box, maxS: number): Hit | null {
  let t0 = 1e-4, t1 = maxS;
  let axis = -1, sign = 0;
  for (let k = 0; k < 3; k++) {
    const ok = o[k] ?? 0, dk = d[k] ?? 0, lo = b.min[k] ?? 0, hi = b.max[k] ?? 0;
    if (Math.abs(dk) < 1e-12) {
      if (ok < lo || ok > hi) return null;
      continue;
    }
    let a = (lo - ok) / dk, c = (hi - ok) / dk;
    let sg = -1;
    if (a > c) {
      [a, c] = [c, a];
      sg = 1;
    }
    if (a > t0) {
      t0 = a;
      axis = k;
      sign = sg;
    }
    t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  if (axis < 0) return null;
  const n: [number, number, number] = [0, 0, 0];
  n[axis] = sign;
  return { s: t0, n, kind: b.kind, id: b.id ?? 0 };
}

function rayBall(o: readonly number[], d: readonly number[], b: Ball, maxS: number): Hit | null {
  const ox = (o[0] ?? 0) - b.c[0], oy = (o[1] ?? 0) - b.c[1], oz = (o[2] ?? 0) - b.c[2];
  const dx = d[0] ?? 0, dy = d[1] ?? 0, dz = d[2] ?? 0;
  const a = dx * dx + dy * dy + dz * dz, bb = ox * dx + oy * dy + oz * dz, c = ox * ox + oy * oy + oz * oz - b.r * b.r;
  const disc = bb * bb - a * c;
  if (disc < 0) return null;
  const s = (-bb - Math.sqrt(disc)) / a;
  if (s <= 1e-4 || s > maxS) return null;
  const px = ox + dx * s, py = oy + dy * s, pz = oz + dz * s;
  return { s, n: [px / b.r, py / b.r, pz / b.r], kind: b.kind, id: 0 };
}

function trace(o: readonly number[], d: readonly number[], maxS = Infinity): Hit | null {
  let best: Hit | null = null;
  for (const b of BOXES) {
    const h = rayBox(o, d, b, best?.s ?? maxS);
    if (h) best = h;
  }
  for (const b of BALLS) {
    const h = rayBall(o, d, b, best?.s ?? maxS);
    if (h) best = h;
  }
  return best;
}
const OCCLUDERS = BOXES.filter((b) => b.occludes === true);
function blocked(o: readonly number[], d: readonly number[], maxS: number): boolean {
  for (const b of OCCLUDERS) if (rayBox(o, d, b, maxS)) return true;
  for (const b of BALLS) if (rayBall(o, d, b, maxS)) return true;
  return false;
}

// --- Materials ----------------------------------------------------------------------------

interface Surface {
  albedo: RGB;
  emit: RGB;
}
const NONE: RGB = [0, 0, 0];

/** Cables snaking from the monitor cabinet across the carpet, in the floor plan. */
const CABLES: readonly (readonly [number, number])[][] = [
  [[-2.2, 4.35], [-2.1, 3.9], [-2.5, 3.3], [-2.45, 2.6], [-2.5, 1.8]],
  [[-0.8, 4.35], [-0.6, 4.1], [0.6, 4.05], [1.3, 3.7], [2.1, 3.9]],
  [[0.3, 4.35], [0.5, 4.2], [1.1, 4.25], [1.5, 4.5], [1.9, 4.4], [2.15, 4.3]],
];
function nearCable(x: number, z: number): number {
  let best = 1;
  for (const line of CABLES) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [ax, az] = line[i] ?? [0, 0], [bx, bz] = line[i + 1] ?? [0, 0];
      const vx = bx - ax, vz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
      best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
    }
  }
  return best;
}

function surfaceFloor(q: Query): Surface {
  const { x, z } = q;
  // Institutional carpet tiles, each laid with its grain turned, worn along the
  // way from the Atrium door to the sofa, stained, with cables across it.
  const tx = Math.floor(x / 0.5), tz = Math.floor(z / 0.5);
  const turned = (tx + tz) % 2 === 0;
  const grain = noise(turned ? x * 60 : x * 8, turned ? z * 8 : z * 60, 1, 3);
  let c = mix(hex("#2c3540"), hex("#3c4652"), grain * 0.6 + hash(tx, tz, 5) * 0.3);
  const worn = Math.exp(-((x + 0.4) ** 2) / 0.5) * smooth((2.2 - z) / 1.5);
  c = mix(c, hex("#5a5e60"), worn * 0.5);
  const stain = fbm(x * 2.2, z * 2.2, 1, 7);
  if (stain > 0.68) c = mix(c, hex("#33291f"), smooth((stain - 0.68) / 0.06) * 0.35);
  const cable = nearCable(x, z);
  if (cable < 0.022) c = cable < 0.008 ? hex("#3a3a40") : hex("#0e0e12");
  const seam = Math.min(Math.abs(x / 0.5 - Math.round(x / 0.5)), Math.abs(z / 0.5 - Math.round(z / 0.5)));
  if (seam < 0.006) c = scale(c, 0.88);
  return { albedo: c, emit: NONE };

}

/** The doorways: to the Archive Console in the back wall, to the Tranquil Pool on the
 * right; each framed, and glowing with the room beyond. */
function doorway(q: Query): Surface | null {
  const { x, y, z, n } = q;
  const backFrame = (n[2] ?? 0) < -0.5 && z > RD - 0.01 && x > CONSOLE_DOOR.x0 - 0.09 && x < CONSOLE_DOOR.x1 + 0.09 && y < CONSOLE_DOOR.y1 + 0.09;
  const inBack = backFrame && x > CONSOLE_DOOR.x0 && x < CONSOLE_DOOR.x1 && y < CONSOLE_DOOR.y1;
  if (backFrame && !inBack) return { albedo: hex("#5a4636"), emit: NONE };
  if (inBack) {
    const g = 1 - y / CONSOLE_DOOR.y1;
    return { albedo: NONE, emit: scale(mix(hex("#ff5fae"), hex("#3ee6d0"), (x - CONSOLE_DOOR.x0) / (CONSOLE_DOOR.x1 - CONSOLE_DOOR.x0)), 0.35 + g * 0.6) };
  }
  return null;
}

function surfaceWall(q: Query): Surface {
  const { x, y, z, n } = q;
  // Wood wainscot below a rail, faded teal paint above, peeling in places.
  const u = Math.abs(n[0] ?? 0) > 0.5 ? z : x;
  const door = doorway(q);
  if (door) return door;
  if (y < 0.9) {
    const panel = (u / 0.6) % 1;
    let c = mix(hex("#3b2a20"), hex("#4f3829"), noise(u * 40, y * 4, 1, 11));
    if (panel < 0.03 || panel > 0.97) c = scale(c, 0.6);
    return { albedo: c, emit: NONE };
  }
  if (y < 0.97) return { albedo: hex("#5a4232"), emit: NONE };
  let c = mix(hex("#36504f"), hex("#42605e"), fbm(u * 3, y * 3, 1, 13));
  const peel = fbm(u * 4, y * 4, 1, 17);
  if (peel > 0.72) c = mix(c, hex("#7f7f72"), smooth((peel - 0.72) / 0.05) * 0.45);
  return { albedo: c, emit: NONE };

}

function surfaceCap(): Surface {
  return { albedo: hex("#1a1a20"), emit: NONE };
}

function surfaceCrt(q: Query): Surface {
  const { x, y, n, id } = q;
  const c = CRTS[id];
  const body = mix(hex("#a39b8a"), hex("#c4bcaa"), hash(id, 0, 21));
  if (!c || (n[2] ?? 0) > -0.5) return { albedo: scale(body, 0.85), emit: NONE };
  // Front: a bezel round a dark screen (the overlay draws what the screen shows).
  const ex = (x - c.x) / (c.w / 2), ey = (y - c.y) / (c.h / 2);
  const inScreen = Math.abs(ex) < 0.8 && ey > -0.72 && ey < 0.84;
  if (inScreen) return { albedo: hex("#0a0d0c"), emit: NONE };
  if (ey < -0.8 && Math.abs(ex - 0.6) < 0.08) return { albedo: NONE, emit: hex("#7dff9a") };
  return { albedo: body, emit: NONE };

}

function surfaceCabinet(q: Query): Surface {
  const { x, y } = q;
  return { albedo: mix(hex("#3a2a20"), hex("#4a3628"), noise(x * 30, y * 3, 1, 23)), emit: NONE };
}

function surfaceBoard(): Surface {
  return { albedo: hex("#3d2c22"), emit: NONE };
}

function surfaceVending(q: Query): Surface {
  const { x, y, z, n } = q;
  if ((n[2] ?? 0) < -0.5) {
    const inPanel = y > 0.75 && y < 1.8 && x > VENDING.x0 + 0.06 && x < VENDING.x1 - 0.2;
    if (inPanel) return { albedo: NONE, emit: [0.75, 0.88, 1.0] };
    if (y > 0.12 && y < 0.42 && x > VENDING.x0 + 0.1 && x < VENDING.x1 - 0.3) return { albedo: hex("#08080c"), emit: NONE };
  }
  return { albedo: mix(hex("#5b2a3a"), hex("#6e3346"), noise(y * 10, z * 10, 1, 31)), emit: NONE };

}

function surfaceShelves(q: Query): Surface {
  const { y, z, n } = q;
  if ((n[0] ?? 0) < 0.5) return { albedo: hex("#2a2420"), emit: NONE };
  // Rows of archive boxes and tape cases, spines in faded colours.
  const row = Math.floor(y / 0.4);
  const inRow = (y / 0.4) % 1;
  if (inRow < 0.07) return { albedo: hex("#2e231c"), emit: NONE };
  const spine = Math.floor((z + hash(row, 0, 41) * 0.3) / 0.075);
  const pal = [hex("#b9a98a"), hex("#6a7058"), hex("#7a4a3a"), hex("#3e4a5e"), hex("#a0907a"), hex("#585048")];
  let c = pal[Math.floor(hash(row, spine, 43) * pal.length)] ?? hex("#b9a98a");
  if (hash(row, spine, 47) < 0.12) c = hex("#1a1614");
  if (inRow > 0.55 && inRow < 0.68) c = mix(c, hex("#e8e0d0"), 0.6);
  return { albedo: scale(c, 0.32 + hash(row, spine, 49) * 0.22), emit: NONE };

}

function surfaceSofa(q: Query): Surface {
  const { x, y, z, n } = q;
  let c = mix(hex("#6e5230"), hex("#86663a"), fbm(x * 8 + z * 8, y * 8, 1, 51));
  c = scale(c, 0.9 + noise(x * 60, z * 60 + y * 60, 1, 53) * 0.12);
  // Three cushions, with sunken seams between.
  const seam = Math.abs((((x + 1.7) / 0.8) % 1) - 0.5);
  if (seam > 0.47 && x > -1.68 && x < 0.68) c = scale(c, 0.55);
  // Worn, rounded edges: lighter along the tops, darker low on the faces.
  if ((n[1] ?? 0) > 0.5 && (y > 0.95 || (y > 0.42 && y < 0.46))) c = mix(c, hex("#a5844e"), 0.35);
  if ((n[2] ?? 0) < -0.5 && y < 0.2) c = scale(c, 0.6);
  return { albedo: c, emit: NONE };
}

function surfaceTable(): Surface {
  return { albedo: hex("#4a3022"), emit: NONE };
}

function surfaceCan(q: Query): Surface {
  const { x, z } = q;
  return { albedo: hash(Math.floor(x * 10), Math.floor(z * 10), 61) < 0.5 ? hex("#c8ccd0") : hex("#a83a3a"), emit: NONE };
}

function surfaceSkin(q: Query): Surface {
  const { n } = q;
  return { albedo: (n[1] ?? 0) > -0.2 || (n[2] ?? 0) < 0 ? hex("#2a1e1a") : hex("#8a5a40"), emit: NONE };
}

function surfaceSweater(): Surface {
  return { albedo: hex("#3c4a6a"), emit: NONE };
}

interface Query {
  x: number;
  y: number;
  z: number;
  n: readonly number[];
  id: number;
}

function surface(kind: Kind, p: readonly number[], n: readonly number[], id: number): Surface {
  const q: Query = { x: p[0] ?? 0, y: p[1] ?? 0, z: p[2] ?? 0, n, id };
  switch (kind) {
    case "floor": return surfaceFloor(q);
    case "wall": return surfaceWall(q);
    case "cap": return surfaceCap();
    case "crt": return surfaceCrt(q);
    case "cabinet": return surfaceCabinet(q);
    case "board": return surfaceBoard();
    case "vending": return surfaceVending(q);
    case "shelves": return surfaceShelves(q);
    case "sofa": return surfaceSofa(q);
    case "table": return surfaceTable();
    case "can": return surfaceCan(q);
    case "skin": return surfaceSkin(q);
    case "sweater": return surfaceSweater();
  }
}

// --- Lights -------------------------------------------------------------------------------

export interface Light {
  p: [number, number, number];
  /** The way the light faces. */
  dir: [number, number, number];
  /** How tightly it points: 0 is all round. */
  focus: number;
  reach: number;
}
export const LIGHTS: readonly Light[] = [
  ...CRTS.map((c): Light => ({ p: [c.x, c.y, CRT_FRONT - 0.05], dir: [0, 0, -1], focus: 1.2, reach: 1.2 + c.w })),
  { p: [(VENDING.x0 + VENDING.x1) / 2 - 0.08, 1.25, VENDING.z0 - 0.08], dir: [0, 0, -1], focus: 0.8, reach: 2.2 },
  { p: [(CONSOLE_DOOR.x0 + CONSOLE_DOOR.x1) / 2, 0.9, RD - 0.05], dir: [0, 0, -1], focus: 1.5, reach: 1.6 },
  { p: [RW - 0.05, 0.9, (POOL_DOOR.z0 + POOL_DOOR.z1) / 2], dir: [-1, 0, 0], focus: 1.5, reach: 1.5 },
];
const NL = LIGHTS.length;

// --- The baked buffers --------------------------------------------------------------------

interface Baked {
  albedo: Float32Array;
  emit: Float32Array;
  sky: Float32Array;
  /** Per pixel, per light: how much of that light arrives. */
  gain: Float32Array;
  /** Per pixel: how far along the view the surface is (larger is further away). */
  depth: Float32Array;
  /** Per pixel: which way the surface faces, for laying brush strokes along it.
   * 0 nothing, 1 up (floor, tops), 2 toward us from the back wall, 3 from the left wall, 4 anything else. */
  facing: Uint8Array;
}

function bake(): Baked {
  const n = W * H;
  const albedo = new Float32Array(n * 3), emit = new Float32Array(n * 3), sky = new Float32Array(n), gain = new Float32Array(n * NL);
  const depth = new Float32Array(n).fill(Infinity);
  const facing = new Uint8Array(n);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      // An orthographic ray: every pixel looks the same way, from its own spot.
      const u = (i + 0.5 - FIT.ox) / SCALE, w = -(j + 0.5 - FIT.oy) / SCALE;
      const o: [number, number, number] = [RIGHT[0] * u + UP[0] * w - DIR[0] * 30, RIGHT[1] * u + UP[1] * w - DIR[1] * 30, RIGHT[2] * u + UP[2] * w - DIR[2] * 30];
      const d = DIR;
      const hit = trace(o, d);
      if (!hit) continue;
      const p: [number, number, number] = [o[0] + d[0] * hit.s, o[1] + d[1] * hit.s, o[2] + d[2] * hit.s];
      depth[k] = dot(p, DIR);
      facing[k] = hit.n[1] > 0.5 ? 1 : hit.n[2] < -0.5 ? 2 : hit.n[0] > 0.5 ? 3 : 4;
      // The top of a wall, seen from above: a dark cut edge.
      const kind: Kind = hit.kind === "wall" && hit.n[1] > 0.5 ? "cap" : hit.kind;
      const sf = surface(kind, p, hit.n, hit.id);
      albedo.set(sf.albedo, k * 3);
      emit.set(sf.emit, k * 3);
      // Sky: the open ceiling above. Floors see the most; corners and under the
      // furniture see less.
      const up = 0.55 + 0.45 * hit.n[1];
      const covered = blocked([p[0] + hit.n[0] * 1e-3, p[1] + hit.n[1] * 1e-3, p[2] + hit.n[2] * 1e-3], [0, 1, 0], 3);
      const corner = Math.min(p[0] + RW, RW - p[0], RD - p[2], p[1] + 9) ;
      sky[k] = up * (covered ? 0.3 : 1) * (0.55 + 0.45 * smooth(corner / 0.6));
      for (const [l, light] of LIGHTS.entries()) {
        const lx = light.p[0] - p[0], ly = light.p[1] - p[1], lz = light.p[2] - p[2];
        const dist = Math.hypot(lx, ly, lz);
        const ux = lx / dist, uy = ly / dist, uz = lz / dist;
        const cos = hit.n[0] * ux + hit.n[1] * uy + hit.n[2] * uz;
        if (cos <= 0) continue;
        const out = -(ux * light.dir[0] + uy * light.dir[1] + uz * light.dir[2]);
        if (out <= 0) continue;
        const spread = out ** light.focus;
        const fall = 1 / (1 + (dist / light.reach) ** 2) ** 1.6;
        const start: [number, number, number] = [p[0] + hit.n[0] * 2e-3, p[1] + hit.n[1] * 2e-3, p[2] + hit.n[2] * 2e-3];
        if (blocked(start, [ux, uy, uz], dist - 0.06)) continue;
        gain[k * NL + l] = cos * spread * fall;
      }
    }
  }
  return { albedo, emit, sky, gain, depth, facing };
}
export const BAKED: Baked = bake();

/** The light leaving pixel k this frame, before tone mapping. */
export function litAt(k: number, a: { lights: readonly RGB[]; sky: RGB }): RGB {
  const { albedo, emit, sky, gain } = BAKED;
  let r = a.sky[0] * (sky[k] ?? 0), g = a.sky[1] * (sky[k] ?? 0), b = a.sky[2] * (sky[k] ?? 0);
  const base = k * NL;
  for (let l = 0; l < NL; l++) {
    const w = gain[base + l] ?? 0;
    if (w === 0) continue;
    const c = a.lights[l] ?? NONE;
    r += c[0] * w;
    g += c[1] * w;
    b += c[2] * w;
  }
  const o = k * 3;
  return [(albedo[o] ?? 0) * r + (emit[o] ?? 0), (albedo[o + 1] ?? 0) * g + (emit[o + 1] ?? 0), (albedo[o + 2] ?? 0) * b + (emit[o + 2] ?? 0)];
}

export function toneMap(c: number): number {
  return 255 * (1 - Math.exp(-c * 1.8));
}

/** Paints the room for one frame as a plain render: each pixel lit on its own. */
export function paintRoom(v: View, a: { lights: readonly RGB[]; sky: RGB }): void {
  const ctx = v.ctx;
  const img = ctx.createImageData(W, H);
  const px = img.data;
  for (let k = 0; k < W * H; k++) {
    const [r, g, b] = litAt(k, a);
    const q = k * 4;
    px[q] = toneMap(r);
    px[q + 1] = toneMap(g);
    px[q + 2] = toneMap(b);
    px[q + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** How far along the view a world point is, comparable with the depth buffer. */
export function depthOf(x: number, y: number, z: number): number {
  return dot([x, y, z], DIR);
}

/** The room's depth at a screen pixel. */
export function sceneDepth(i: number, j: number): number {
  return i < 0 || j < 0 || i >= W || j >= H ? Infinity : (BAKED.depth[j * W + i] ?? Infinity);
}

/** The light falling on a point this frame, from every light and the sky, without
 * shadows: for tinting something that moves through the room. */
export function lightAt(p: readonly [number, number, number], a: { lights: readonly RGB[]; sky: RGB }): RGB {
  const out: RGB = [a.sky[0] * 0.9, a.sky[1] * 0.9, a.sky[2] * 0.9];
  for (const [l, light] of LIGHTS.entries()) {
    const lx = light.p[0] - p[0], ly = light.p[1] - p[1], lz = light.p[2] - p[2];
    const dist = Math.hypot(lx, ly, lz);
    const out1 = -(lx * light.dir[0] + ly * light.dir[1] + lz * light.dir[2]) / dist;
    if (out1 <= 0) continue;
    const k = 0.22 * out1 ** light.focus / (1 + (dist / light.reach) ** 2) ** 1.6;
    const c = a.lights[l] ?? NONE;
    out[0] += c[0] * k;
    out[1] += c[1] * k;
    out[2] += c[2] * k;
  }
  return out;
}

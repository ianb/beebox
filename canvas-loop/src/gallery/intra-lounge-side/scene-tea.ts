// The Archive Lounge as a cross-section seen from the side, drawn by hand. Only the
// still parts are here; what glows and moves is drawn per frame (live-tea.ts).
//
// Depth runs down the screen: the back wall stands on the floor line at FLOOR, the
// sofa a little nearer, the walker's path nearer still, and dark foreground shapes
// along the bottom edge in front of everything.
import type { Vec2, View } from "@ianbicking/canvas-loop";
import { INK, type Rim, blob, ellipsePts, hash, ink, rivet, roundRectPts, stroke, wobble } from "./ink-tea.js";
import { PLANES, SIZES, footY, m } from "./sizes-tea.js";

export const W = 1280, H = 720;
/** Where the back wall meets the floor, and the floor's near edge. */
export const FLOOR = 560, NEAR = 662;
/** The ceiling frame's lower edge. */
export const CEIL = 118;

// --- Placing things at their true size --------------------------------------------------

/** Each thing is drawn in its own design coordinates, then placed: the design point
 * `from` lands on the screen point `to`, scaled by `s` so the thing has its size
 * in sizes-tea.ts, standing at its depth plane. */
export interface Place {
  from: Vec2;
  to: Vec2;
  s: number;
}
export function placed(v: View, p: Place, body: () => void): void {
  v.at({ translate: p.to, scale: p.s }, () => v.at({ translate: [-p.from[0], -p.from[1]] }, body));
}
/** Where a design point of a placed thing lands on the screen. */
export function onScreen(p: Place, pt: Vec2): Vec2 {
  return [p.to[0] + (pt[0] - p.from[0]) * p.s, p.to[1] + (pt[1] - p.from[1]) * p.s];
}

/** The things in the room: design anchor (bottom middle or bottom left), where it
 * stands, and the scale that gives it its real height. */
export const PLACES = {
  arch: { from: [42, 560], to: [30, footY(0)], s: m(SIZES.arch.h) / 260 },
  shelves: { from: [176, 560], to: [210, footY(PLANES.wall)], s: m(SIZES.shelves.h) / 376 },
  cabinet: { from: [691, 560], to: [650, footY(PLANES.wall)], s: m(SIZES.cabinet.h) / 80 },
  tellies: { from: [690, 480], to: [650, footY(PLANES.wall) - m(SIZES.cabinet.h)], s: m(SIZES.crtLarge.h) / 104 },
  vending: { from: [1005, 560], to: [950, footY(PLANES.wall)], s: m(SIZES.vending.h) / 208 },
  poolDoor: { from: [1132, 560], to: [1110, footY(0)], s: m(SIZES.door.h) / 230 },
  sofa: { from: [698, 616], to: [650, footY(PLANES.sofa)], s: m(SIZES.sofa.h) / 128 },
} as const satisfies Record<string, Place>;

/** The glow of the television stack, on screen, for rim light. */
const SCREENS: Rim = { ...{ colour: "#9ff0d8", reach: 460 }, x: onScreen(PLACES.tellies, [690, 380])[0], y: onScreen(PLACES.tellies, [690, 380])[1] };
/** The same light in a placed thing's own design coordinates. */
function rimFor(p: Place): Rim {
  return { colour: SCREENS.colour, x: p.from[0] + (SCREENS.x - p.to[0]) / p.s, y: p.from[1] + (SCREENS.y - p.to[1]) / p.s, reach: SCREENS.reach / p.s };
}

// --- Television sets ---------------------------------------------------------------------

export type Show = "text" | "bars" | "scope" | "hex" | "roll" | "static" | "map";
export interface Telly {
  /** Left edge, bottom (where it rests), width, height. */
  x: number;
  base: number;
  w: number;
  h: number;
  show: Show;
  body: string;
  /** Lean, radians. */
  tilt: number;
  antenna?: boolean;
}
export const TELLIES: readonly Telly[] = [
  { x: 520, base: 480, w: 120, h: 104, show: "text", body: "#b8ab8c", tilt: -0.02 },
  { x: 645, base: 480, w: 104, h: 92, show: "bars", body: "#8e9286", tilt: 0.015 },
  { x: 755, base: 480, w: 112, h: 110, show: "roll", body: "#a8946c", tilt: -0.01 },
  { x: 540, base: 376, w: 96, h: 80, show: "hex", body: "#9a9c8c", tilt: 0.04 },
  { x: 640, base: 388, w: 112, h: 96, show: "static", body: "#b5a588", tilt: -0.03 },
  { x: 758, base: 370, w: 90, h: 76, show: "scope", body: "#8c8070", tilt: 0.05 },
  { x: 575, base: 296, w: 82, h: 66, show: "map", body: "#a39478", tilt: -0.06, antenna: true },
  { x: 668, base: 292, w: 76, h: 62, show: "text", body: "#b9ac90", tilt: 0.07 },
];

/** A set's screen, in the set's own upright frame (before it leans). */
export function screenOf(t: Telly): { x: number; y: number; w: number; h: number } {
  return { x: t.x + t.w * 0.09, y: t.base - t.h + t.h * 0.12, w: t.w * 0.68, h: t.h * 0.7 };
}

/** Draws `body` leaning with set t, about the middle of its base. */
export function leaning(v: View, t: Telly, body: () => void): void {
  const px = t.x + t.w / 2, py = t.base;
  v.at({ translate: [px, py], rotate: t.tilt }, () => v.at({ translate: [-px, -py] }, body));
}

function telly(v: View, t: Telly, seed: number, rim: Rim): void {
  const { x, base, w, h } = t;
  const top = base - h;
  // The casing bulges: a little wider at the top, rounded everywhere.
  const casing: Vec2[] = [[x + 4, base], [x + w - 4, base], [x + w + 2, top + h * 0.3], [x + w - 2, top], [x + 2, top], [x - 2, top + h * 0.3]];
  blob(v, casing, { fill: t.body, light: "#ddd2b6", dark: "#5a5048", seed, shadeSide: "right", line: 2.6, amp: 1.6, rim });
  const s = screenOf(t);
  blob(v, roundRectPts(s.x - 4, s.y - 4, s.w + 8, s.h + 8, Math.min(s.w, s.h) * 0.25), { fill: "#4a4038", seed: seed + 1, line: 1.8, amp: 0.8 });
  blob(v, roundRectPts(s.x, s.y, s.w, s.h, Math.min(s.w, s.h) * 0.22), { fill: "#121614", seed: seed + 2, line: 2.2, amp: 0.6 });
  // Knobs, a grille and a maker's plate on the side panel.
  const kx = x + w * 0.88;
  for (let k = 0; k < 2; k++) {
    const ky = top + h * (0.25 + k * 0.24);
    v.circle(kx, ky, w * 0.055, { fill: "#3a302a" });
    v.circle(kx, ky, w * 0.055, ink(seed + 3 + k, 1.4));
    v.line(kx, ky, kx + Math.cos(seed + k) * w * 0.045, ky + Math.sin(seed + k) * w * 0.045, { stroke: "#cbbd9e", weight: 1.4 });
  }
  for (let g = 0; g < 5; g++) stroke(v, [[kx - w * 0.05, top + h * 0.66 + g * 4], [kx + w * 0.05, top + h * 0.66 + g * 4]], { seed: seed + 10 + g, weight: 1.1, amp: 0.3 });
  rivet(v, x + 7, top + 7);
  rivet(v, x + w - 7, top + 7);
  // Little feet.
  for (const fx of [x + 12, x + w - 18]) blob(v, roundRectPts(fx, base - 2, 8, 5, 2), { fill: "#2a2420", seed: seed + 20 + fx, line: 1, amp: 0.3 });
  if (t.antenna === true) {
    stroke(v, [[x + w * 0.45, top], [x + w * 0.2, top - 50]], { seed: seed + 30, weight: 1.8, amp: 0.4 });
    stroke(v, [[x + w * 0.55, top], [x + w * 0.9, top - 44]], { seed: seed + 31, weight: 1.8, amp: 0.4 });
    v.circle(x + w * 0.2, top - 50, 2.5, { fill: INK });
    blob(v, ellipsePts(x + w * 0.5, top - 2, 9, 5), { fill: "#3a302a", seed: seed + 32, line: 1.4 });
  }
}

// --- The room ------------------------------------------------------------------------------

function wall(v: View): void {
  const pts: Vec2[] = [[24, FLOOR], [W - 24, FLOOR], [W - 28, CEIL], [W / 2, CEIL + 6], [28, CEIL]];
  blob(v, pts, { fill: "#5e6d66", light: "#76857b", dark: "#46524c", seed: 1, amp: 3 });
  // Stains running down from the ceiling, and a few cracks.
  for (let i = 0; i < 9; i++) {
    const x = 60 + hash(i, 0, 2) * (W - 120);
    stroke(v, [[x, CEIL + 4], [x + 3, CEIL + 50 + hash(i, 1, 3) * 120]], { seed: 10 + i, weight: 9, colour: "rgba(50,60,52,0.35)", amp: 2.5 });
  }
  for (let i = 0; i < 4; i++) {
    const x = 120 + hash(i, 2, 4) * (W - 240), y = 200 + hash(i, 3, 5) * 160;
    stroke(v, [[x, y], [x + 12, y + 18], [x + 6, y + 34], [x + 18, y + 52]], { seed: 20 + i, weight: 1.2, amp: 1.2 });
  }
  // Riveted plates along the bottom.
  for (let x = 28; x < W - 28; x += 82) {
    blob(v, [[x, FLOOR], [x + 82, FLOOR], [x + 82, FLOOR - 74], [x, FLOOR - 74]], { fill: "#6a5446", light: "#86705e", dark: "#3e3028", seed: 30 + x, amp: 1, line: 1.8 });
    for (let r = x + 10; r < x + 78; r += 14) {
      rivet(v, r, FLOOR - 67);
      rivet(v, r, FLOOR - 7);
    }
    stroke(v, [[x + 22, FLOOR - 66], [x + 24, FLOOR - 40]], { seed: 40 + x, weight: 4, colour: "rgba(122,58,30,0.45)", amp: 0.6 });
  }
}

/** The ceiling: a heavy riveted beam holding the sky-screen panels (lit per frame). */
export const PANELS: readonly [number, number][] = [[52, 330], [340, 640], [650, 940], [950, 1228]];
/** The third panel is dead: cracked and dark. */
export const DEAD_PANEL = 2;
function ceiling(v: View): void {
  blob(v, [[0, 0], [W, 0], [W, 46], [W / 2, 52], [0, 46]], { fill: "#2c2a30", dark: "#18161a", seed: 50, amp: 2 });
  for (let x = 20; x < W; x += 36) rivet(v, x, 38);
  for (const [i, [a, b]] of PANELS.entries()) {
    const sag = 4 + i;
    blob(v, [[a - 6, 44], [b + 6, 44], [b + 6, CEIL + 6], [(a + b) / 2, CEIL + 6 + sag], [a - 6, CEIL + 6]], { fill: "#3a363e", seed: 60 + i, line: 2.4, amp: 1.2 });
    blob(v, [[a, 52], [b, 52], [b, CEIL - 2], [(a + b) / 2, CEIL - 2 + sag], [a, CEIL - 2]], { fill: "#0e1018", seed: 70 + i, line: 1.6, amp: 0.8 });
  }
  // Cracks across the dead panel.
  const [da] = PANELS[DEAD_PANEL] ?? [0, 0];
  stroke(v, [[da + 60, 56], [da + 110, 82], [da + 96, 100], [da + 150, 114]], { seed: 80, weight: 1.6, colour: "#6a7080" });
  stroke(v, [[da + 110, 82], [da + 170, 70], [da + 230, 92]], { seed: 81, weight: 1.2, colour: "#6a7080" });
  // Cables sagging down from the beam.
  stroke(v, [[260, 46], [300, 150], [380, 170], [420, 120]], { seed: 82, weight: 3, colour: "#1c1814" });
  stroke(v, [[900, 46], [940, 190], [1010, 210], [1030, 150]], { seed: 83, weight: 3, colour: "#2a2030" });
  // A bare bulb on a cord.
  stroke(v, [[478, 50], [480, 160], [478, 214]], { seed: 84, weight: 1.6 });
  blob(v, roundRectPts(472, 212, 12, 10, 2), { fill: "#3a302a", seed: 85, line: 1.4 });
  blob(v, ellipsePts(478, 232, 10, 13), { fill: "#d8d0b0", light: "#f0ead0", seed: 86, line: 1.6 });
}

function pipes(v: View): void {
  const run: Vec2[] = [[24, 168], [180, 166], [300, 172], [420, 166], [450, 180], [452, 236], [470, 250], [1100, 248], [1124, 262], [1126, 330]];
  const tube = v.tube(run, { width: 16 });
  v.path(tube, { fill: "#7a6650" });
  stroke(v, run.map(([x, y]): Vec2 => [x, y - 4]), { seed: 91, weight: 3, colour: "#b49a76", amp: 0.5 });
  v.path(tube, ink(90, 2.2));
  for (const [x, y] of [[180, 166], [452, 212], [700, 249], [1000, 248]] as const) {
    blob(v, roundRectPts(x - 6, y - 12, 12, 24, 3), { fill: "#5e4c3c", seed: 92 + x, line: 1.6, amp: 0.4 });
  }
  // A valve wheel and a pressure gauge.
  v.circle(300, 172, 13, { stroke: "#8a2e22", weight: 3.5 });
  for (let k = 0; k < 3; k++) v.line(300, 172, 300 + Math.cos(k * 2.1) * 12, 172 + Math.sin(k * 2.1) * 12, { stroke: "#8a2e22", weight: 2 });
  v.circle(300, 172, 13, ink(95, 1.2));
  blob(v, ellipsePts(860, 222, 16, 16), { fill: "#d8ccb0", seed: 96, line: 2 });
  v.line(860, 222, 870, 213, { stroke: "#8a2e22", weight: 1.6 });
  stroke(v, [[860, 238], [860, 248]], { seed: 97, weight: 3 });
}

function atriumArch(v: View): void {
  // The archway to the Atrium, on the left (its warm light is drawn per frame).
  const arch: Vec2[] = [[52, FLOOR], [152, FLOOR], [152, 360]];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI;
    arch.push([102 + Math.cos(a) * 50, 360 - Math.sin(a) * 50]);
  }
  arch.push([52, 360]);
  blob(v, arch.map(([x, y]): Vec2 => [x + (x < 102 ? -10 : 10), y - 10]), { fill: "#8a7a64", dark: "#4a3e32", seed: 100, line: 2.4 });
  v.curve(wobble(arch, { seed: 101, amp: 1 }), true, { fill: "#1a1216" });
  v.curve(wobble(arch, { seed: 101, amp: 1 }), true, ink(101, 2.4));
}

function poolDoor(v: View): void {
  // The door to the Tranquil Pool, on the right, standing ajar.
  blob(v, [[1132, FLOOR], [1232, FLOOR], [1232, 330], [1132, 330]], { fill: "#4a3e36", seed: 102, line: 2.6 });
  blob(v, [[1140, FLOOR], [1226, FLOOR], [1226, 338], [1140, 338]], { fill: "#1a1418", seed: 103, line: 1.8 });
  blob(v, [[1140, FLOOR + 2], [1172, FLOOR + 14], [1172, 350], [1140, 338]], { fill: "#6a4a3a", light: "#8a6a4a", dark: "#3a2a20", seed: 104, line: 2 });
  v.circle(1164, 450, 3, { fill: "#c9a46a" });
}

/** The leaning tape shelves, with the archive machine in their foot. */
function shelves(v: View, rim: Rim): void {
  v.at({ translate: [280, FLOOR], rotate: -0.025 }, () => v.at({ translate: [-280, -FLOOR] }, () => {
    blob(v, [[176, FLOOR], [384, FLOOR], [384, 184], [176, 184]], { fill: "#5a3e2a", dark: "#2e1e14", seed: 110, line: 2.6, rim });
    for (const [row, y] of [260, 340, 420].entries()) {
      // Things on the shelf: reels in cases, binders, boxes.
      for (let x = 186; x < 372;) {
        const kind = hash(row, x, 111);
        const width = kind < 0.4 ? 30 : kind < 0.75 ? 13 : 38;
        const height = kind < 0.4 ? 52 : kind < 0.75 ? 62 - hash(row, x, 112) * 12 : 36;
        if (x + width > 376) break;
        const colours = ["#c2ae84", "#6d7458", "#844a3a", "#43506a", "#a99678", "#5d554c"];
        const fill = colours[Math.floor(hash(row, x, 113) * colours.length)] ?? "#c2ae84";
        const lean = kind > 0.9 ? 0.25 : 0;
        v.at({ translate: [x, y], rotate: lean }, () => {
          blob(v, [[0, 0], [width, 0], [width, -height], [0, -height]], { fill, dark: "#2a201a", seed: 120 + row * 100 + x, line: 1.4, amp: 0.7 });
          if (kind < 0.4) {
            v.circle(width / 2, -height * 0.55, 10, { fill: "#1e1a18" });
            v.circle(width / 2, -height * 0.55, 3.5, { fill: "#c8b898" });
          } else if (kind < 0.75) {
            v.rect(2, -height * 0.7, width - 4, 6, { fill: "#e8e0d0" });
          }
        });
        x += width + 2 + hash(row, x, 114) * 3;
      }
      blob(v, [[178, y], [382, y], [382, y + 9], [280, y + 13], [178, y + 9]], { fill: "#7a5638", light: "#9a7450", seed: 130 + row, line: 2 });
    }
    // The archive machine: two big reels (turning, per frame), dials, a row of lights.
    blob(v, [[186, FLOOR - 4], [374, FLOOR - 4], [374, 440], [186, 440]], { fill: "#5a6a6a", light: "#7a8c8a", dark: "#2e3a3a", seed: 140, line: 2.4, rim });
    for (const cx of [228, 300]) {
      v.circle(cx, 486, 27, { fill: "#2a2e30" });
      v.circle(cx, 486, 27, ink(141 + cx, 2));
    }
    for (let i = 0; i < 2; i++) {
      v.circle(348, 470 + i * 26, 9, { fill: "#d8ccb0" });
      v.circle(348, 470 + i * 26, 9, ink(150 + i, 1.4));
      v.line(348, 470 + i * 26, 348 + Math.cos(i * 2 + 0.5) * 7, 470 + i * 26 + Math.sin(i * 2 + 0.5) * 7, { stroke: "#8a2e22", weight: 1.5 });
    }
  }));
}

function cabinet(v: View, rim: Rim): void {
  blob(v, [[498, FLOOR], [884, FLOOR], [880, 480], [500, 482]], { fill: "#5e4030", light: "#7a5640", dark: "#3a2618", seed: 160, line: 2.4, rim });
  for (let i = 0; i < 3; i++) {
    const a = 512 + i * 122;
    blob(v, roundRectPts(a, 494, 112, 52, 5), { fill: "#6c4a36", dark: "#3a2618", seed: 161 + i, line: 1.4, amp: 0.8 });
    v.circle(a + 56, 520, 4, { fill: "#c9a46a" });
  }
  // A shim of folded paper under one foot, keeping it level, more or less.
  blob(v, [[870, FLOOR], [892, FLOOR], [890, FLOOR - 5], [872, FLOOR - 6]], { fill: "#e8e0c8", seed: 165, line: 1 });
}

function cables(v: View): void {
  const lines: Vec2[][] = [
    [[560, 470], [540, 540], [470, 572], [380, 568]],
    [[700, 470], [720, 548], [820, 576], [940, 566]],
    [[800, 362], [890, 400], [910, 470], [905, 556]],
    [[612, 290], [560, 320], [530, 372]],
  ];
  for (const [i, line] of lines.entries()) stroke(v, line, { seed: 170 + i, weight: 3.4, colour: i % 2 === 0 ? "#1c1814" : "#3a2e3a", amp: 1.5 });
}

/** The vending tank, dented and riveted, its window lit per frame. */
export const VENDING = { x: 1005, top: 352 };
function vending(v: View, rim: Rim): void {
  const { x } = VENDING;
  const r = 56;
  const body: Vec2[] = [[x - r, FLOOR], [x + r, FLOOR], [x + r + 3, 430]];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI;
    body.push([x + Math.cos(a) * (r + 3), 430 - Math.sin(a) * 78]);
  }
  body.push([x - r - 3, 430]);
  blob(v, body, { fill: "#8a3e2e", light: "#a85840", dark: "#4a1e16", seed: 180, shadeSide: "right", amp: 2, line: 2.6, rim });
  for (const y of [FLOOR - 26, 430]) {
    stroke(v, [[x - r - 2, y], [x, y + 6], [x + r + 2, y]], { seed: 181 + y, weight: 2 });
    for (let i = -3; i <= 3; i++) rivet(v, x + i * 15, y + 4 - Math.abs(i) * 0.6);
  }
  blob(v, roundRectPts(x - 34, 384, 52, 104, 18), { fill: "#2a2028", seed: 183, line: 2.8 });
  blob(v, roundRectPts(x + 28, 420, 11, 26, 3), { fill: "#c9a46a", seed: 184, line: 1.4 });
  v.line(x + 33.5, 425, x + 33.5, 441, { stroke: INK, weight: 2 });
  blob(v, roundRectPts(x - 26, FLOOR - 64, 40, 18, 6), { fill: "#1a1416", seed: 185, line: 1.8 });
  stroke(v, [[x + 16, 372], [x + 30, 380], [x + 24, 392]], { seed: 186, weight: 1.4 });
}

function floor(v: View): void {
  blob(v, [[0, FLOOR - 2], [W, FLOOR - 2], [W, NEAR], [0, NEAR]], { fill: "#5a4838", light: "#76604a", dark: "#3a2e24", seed: 200, amp: 2 });
  // Boards running along the room, getting wider toward us.
  for (const [i, y] of [574, 590, 610, 634].entries()) stroke(v, [[0, y], [W / 2, y + (hash(i, 0, 201) - 0.5) * 4], [W, y]], { seed: 202 + i, weight: 1.2, colour: "#2e241d", amp: 1.2 });
  for (let i = 0; i < 18; i++) {
    const x = hash(i, 0, 203) * W, row = Math.floor(hash(i, 1, 204) * 4);
    const ys = [560, 574, 590, 610, 634];
    stroke(v, [[x, ys[row] ?? 560], [x + 2, ys[row + 1] ?? 574]], { seed: 210 + i, weight: 1, colour: "#2e241d", amp: 0.3 });
  }
  // The rug under the sofa, frayed.
  blob(v, ellipsePts(650, 604, 250, 26, 30), { fill: "#6e3d36", light: "#8a5246", dark: "#4a2622", seed: 220, amp: 1.5 });
  v.curve(wobble(ellipsePts(650, 604, 220, 19, 28), { seed: 221, amp: 1 }), true, { stroke: "#b8925c", weight: 2.2, brush: { preset: "chalk", opacity: 0.7 }, gesture: { seed: 221 } });
}

/** The sofa, its back to us, facing the screens; someone sitting in it. */
function sofa(v: View, rim: Rim): void {
  // Back cushions, lumpy, then the body and arms.
  for (let i = 0; i < 3; i++) {
    const x = 560 + i * 92;
    blob(v, [[x, 560], [x + 94, 560], [x + 92, 498 + (i % 2) * 6], [x + 46, 488 + (i % 2) * 6], [x + 2, 498 + (i % 2) * 6]], { fill: i === 1 ? "#93703f" : "#8c6b3e", light: "#a8844e", dark: "#5a4224", seed: 232 + i, shadeSide: "bottom", rim });
  }
  blob(v, [[548, 616], [848, 616], [852, 548], [544, 548]], { fill: "#86653a", light: "#a8844e", dark: "#4a3820", seed: 240, shadeSide: "bottom" });
  for (const [a, b] of [[524, 566], [830, 872]] as const) {
    blob(v, [[a + 4, 616], [b - 4, 616], [b, 522], [(a + b) / 2, 508], [a, 522]], { fill: "#7a5c34", light: "#93703f", dark: "#4a3820", seed: 241 + a, shadeSide: "right", rim });
  }
  // A sewn-on patch, and stubby legs.
  blob(v, [[640, 572], [672, 570], [670, 598], [642, 600]], { fill: "#5a6a4a", seed: 245, line: 1.4 });
  for (let i = 0; i < 7; i++) v.line(640 + i * 5, 571, 641 + i * 5, 575, { stroke: "#e8dcc0", weight: 1 });
  for (const lx of [560, 830]) blob(v, roundRectPts(lx, 614, 12, 10, 3), { fill: "#2a1e14", seed: 246 + lx, line: 1.2, amp: 0.3 });
}

/** The sitter: head and shoulders over the sofa's back, dark against the screens.
 * Drawn after the screens' glow, and only above the cushions. */
export function sitter(v: View): void {
  const rim = rimFor(PLACES.sofa);
  v.clip([[0, 0], [W, 0], [W, 494], [0, 494]], () => {
    blob(v, ellipsePts(664, 486, 44, 28), { fill: "#1e2436", light: "#2c3550", seed: 230, line: 2.4, rim });
    blob(v, ellipsePts(668, 446, 20, 23), { fill: "#1a120e", light: "#2a1e16", seed: 231, line: 2.4, rim });
    // Hair sticking up, catching the light.
    stroke(v, [[660, 425], [656, 416]], { seed: 232, weight: 2 });
    stroke(v, [[668, 423], [669, 413]], { seed: 233, weight: 2 });
  });
}

/** Dark shapes along the bottom edge, nearest of all: a pipe, a crate, cables. */
export function foreground(v: View): void {
  const dark = { fill: "#0f0d12", line: 2.4 };
  blob(v, [[0, 640], [150, 646], [158, 720], [0, 720]], { ...dark, seed: 300 });
  stroke(v, [[20, 660], [140, 664]], { seed: 301, weight: 1.4, colour: "#2a2630" });
  stroke(v, [[24, 690], [146, 694]], { seed: 302, weight: 1.4, colour: "#2a2630" });
  const run: Vec2[] = [[140, 712], [400, 700], [640, 704], [900, 698], [1130, 706], [1280, 700]];
  const tube = v.tube(run, { width: 26 });
  v.path(tube, { fill: "#141118" });
  v.path(tube, ink(303, 2.4));
  for (const x of [400, 900]) blob(v, roundRectPts(x - 9, 680, 18, 40, 4), { ...dark, seed: 304 + x });
  stroke(v, [[1180, 640], [1220, 700], [1280, 690]], { seed: 306, weight: 4, colour: "#0c0a0e" });
}

/** The still room, back to front, without the foreground. */
export function paintRoom(v: View): void {
  v.background("#121016");
  wall(v);
  pipes(v);
  placed(v, PLACES.arch, () => atriumArch(v));
  placed(v, PLACES.poolDoor, () => poolDoor(v));
  placed(v, PLACES.shelves, () => shelves(v, rimFor(PLACES.shelves)));
  placed(v, PLACES.cabinet, () => {
    cabinet(v, rimFor(PLACES.cabinet));
    cables(v);
  });
  placed(v, PLACES.tellies, () => {
    for (const [i, t] of TELLIES.entries()) leaning(v, t, () => telly(v, t, 500 + i * 20, rimFor(PLACES.tellies)));
  });
  ceiling(v);
  floor(v);
  placed(v, PLACES.vending, () => vending(v, rimFor(PLACES.vending)));
  placed(v, PLACES.sofa, () => sofa(v, rimFor(PLACES.sofa)));
  v.paperTexture(0.4);
}

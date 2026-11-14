// Archive Lounge. From intra-game: "Archive Lounge: small, quiet, lined with old glitching monitors displaying unreadable data. A vending machine hums in the corner, offering unlabeled drinks. Sky: pixelated blue with bursts of static, flashing error messages before resetting."
// Exits (3): Hollow Atrium (edge-left), Tranquil Pool (edge-right), Archive Console (ladder).
//
// The established look from intra-lounge-side, moved into the kit: the leaning
// tape shelves with the archive machine in their foot (reels turning), the
// cabinet with its stack of eight sets showing unreadable data (two throw ERROR),
// the lumpy sofa with someone sitting in it facing the screens, the dented vending
// tank with unlabelled cans. Each piece is drawn in its old design coordinates and
// placed through the kit's at() at the scale sizes-tea.ts gives it.
//
// Sketch files may import only sibling -tea helpers, so intra-lounge-side's
// painters (placing, the sets, shelves, cabinet, vending tank, sofa, sitter and
// the per-frame pictures) are copied here, unchanged but for the rim light.
import type { Vec2, View } from "@ianbicking/canvas-loop";
import type { Rim } from "./ink-tea.js";
import { INK, type RoomSpec, at, blob, ellipsePts, glow, hash, ink, rgba, rivet, roundRectPts, stroke, wobble } from "./kit-tea.js";
import { bareBulb } from "./parts-c-tea.js";
import { amaEye, amaSpeaker, citizen, pacing, pipe, poster } from "./props-tea.js";
import { PLANES, SIZES, m } from "./sizes-tea.js";

// --- Placing, the set list (copied from intra-lounge-side/scene-tea.ts) -------------------------

/** The design floor line the old painters were drawn on. */
const FLOOR = 560;
interface Place {
  from: Vec2;
  to: Vec2;
  s: number;
}
function placed(v: View, p: Place, body: () => void): void {
  v.at({ translate: p.to, scale: p.s }, () => v.at({ translate: [-p.from[0], -p.from[1]] }, body));
}
function onScreen(p: Place, pt: Vec2): Vec2 {
  return [p.to[0] + (pt[0] - p.from[0]) * p.s, p.to[1] + (pt[1] - p.from[1]) * p.s];
}
type Show = "text" | "bars" | "scope" | "hex" | "roll" | "static" | "map";
interface Telly {
  x: number;
  base: number;
  w: number;
  h: number;
  show: Show;
  body: string;
  tilt: number;
  antenna?: boolean;
}
const TELLIES: readonly Telly[] = [
  { x: 520, base: 480, w: 120, h: 104, show: "text", body: "#b8ab8c", tilt: -0.02 },
  { x: 645, base: 480, w: 104, h: 92, show: "bars", body: "#8e9286", tilt: 0.015 },
  { x: 755, base: 480, w: 112, h: 110, show: "roll", body: "#a8946c", tilt: -0.01 },
  { x: 540, base: 376, w: 96, h: 80, show: "hex", body: "#9a9c8c", tilt: 0.04 },
  { x: 640, base: 388, w: 112, h: 96, show: "static", body: "#b5a588", tilt: -0.03 },
  { x: 758, base: 370, w: 90, h: 76, show: "scope", body: "#8c8070", tilt: 0.05 },
  { x: 575, base: 296, w: 82, h: 66, show: "map", body: "#a39478", tilt: -0.06, antenna: true },
  { x: 668, base: 292, w: 76, h: 62, show: "text", body: "#b9ac90", tilt: 0.07 },
];
function screenOf(t: Telly): { x: number; y: number; w: number; h: number } {
  return { x: t.x + t.w * 0.09, y: t.base - t.h + t.h * 0.12, w: t.w * 0.68, h: t.h * 0.7 };
}
function leaning(v: View, t: Telly, body: () => void): void {
  const px = t.x + t.w / 2, py = t.base;
  v.at({ translate: [px, py], rotate: t.tilt }, () => v.at({ translate: [-px, -py] }, body));
}
const VENDING = { x: 1005, top: 352 };

/** Where each piece's design anchor lands in the kit's room, and its scale. */
const PLACES = {
  shelves: { from: [176, 560], to: at(0.72, 0, PLANES.wall), s: m(SIZES.shelves.h) / 376 },
  cabinet: { from: [691, 560], to: at(4.5, 0, PLANES.wall), s: m(SIZES.cabinet.h) / 80 },
  tellies: { from: [690, 480], to: at(4.5, SIZES.cabinet.h, PLANES.wall), s: m(SIZES.crtLarge.h) / 104 },
  vending: { from: [1005, 560], to: at(6.8, 0, PLANES.wall), s: m(SIZES.vending.h) / 208 },
  sofa: { from: [698, 616], to: at(4.5, 0, PLANES.sofa), s: m(SIZES.sofa.h) / 128 },
} as const satisfies Record<string, Place>;

const SCREENS_AT = onScreen(PLACES.tellies, [690, 380]);
const SCREENS: Rim = { colour: "#9ff0d8", reach: 460, x: SCREENS_AT[0], y: SCREENS_AT[1] };
function rimFor(p: Place): Rim {
  return { colour: SCREENS.colour, x: p.from[0] + (SCREENS.x - p.to[0]) / p.s, y: p.from[1] + (SCREENS.y - p.to[1]) / p.s, reach: SCREENS.reach / p.s };
}

// --- Copied from intra-lounge-side/scene-tea.ts (design coordinates) ----------------------------

function telly(v: View, t: Telly, seed: number, rim: Rim): void {
  const { x, base, w, h } = t;
  const top = base - h;
  const casing: Vec2[] = [[x + 4, base], [x + w - 4, base], [x + w + 2, top + h * 0.3], [x + w - 2, top], [x + 2, top], [x - 2, top + h * 0.3]];
  blob(v, casing, { fill: t.body, light: "#ddd2b6", dark: "#5a5048", seed, shadeSide: "right", line: 2.6, amp: 1.6, rim });
  const s = screenOf(t);
  blob(v, roundRectPts(s.x - 4, s.y - 4, s.w + 8, s.h + 8, Math.min(s.w, s.h) * 0.25), { fill: "#4a4038", seed: seed + 1, line: 1.8, amp: 0.8 });
  blob(v, roundRectPts(s.x, s.y, s.w, s.h, Math.min(s.w, s.h) * 0.22), { fill: "#121614", seed: seed + 2, line: 2.2, amp: 0.6 });
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
  for (const fx of [x + 12, x + w - 18]) blob(v, roundRectPts(fx, base - 2, 8, 5, 2), { fill: "#2a2420", seed: seed + 20 + fx, line: 1, amp: 0.3 });
  if (t.antenna === true) {
    stroke(v, [[x + w * 0.45, top], [x + w * 0.2, top - 50]], { seed: seed + 30, weight: 1.8, amp: 0.4 });
    stroke(v, [[x + w * 0.55, top], [x + w * 0.9, top - 44]], { seed: seed + 31, weight: 1.8, amp: 0.4 });
    v.circle(x + w * 0.2, top - 50, 2.5, { fill: INK });
    blob(v, ellipsePts(x + w * 0.5, top - 2, 9, 5), { fill: "#3a302a", seed: seed + 32, line: 1.4 });
  }
}

function shelves(v: View, rim: Rim): void {
  v.at({ translate: [280, FLOOR], rotate: -0.025 }, () => v.at({ translate: [-280, -FLOOR] }, () => {
    blob(v, [[176, FLOOR], [384, FLOOR], [384, 184], [176, 184]], { fill: "#5a3e2a", dark: "#2e1e14", seed: 110, line: 2.6, rim });
    for (const [row, y] of [260, 340, 420].entries()) {
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
  blob(v, [[870, FLOOR], [892, FLOOR], [890, FLOOR - 5], [872, FLOOR - 6]], { fill: "#e8e0c8", seed: 165, line: 1 });
  const lines: Vec2[][] = [
    [[560, 470], [540, 540], [470, 572], [380, 568]],
    [[700, 470], [720, 548], [820, 576], [940, 566]],
    [[800, 362], [890, 400], [910, 470], [905, 556]],
    [[612, 290], [560, 320], [530, 372]],
  ];
  for (const [i, line] of lines.entries()) stroke(v, line, { seed: 170 + i, weight: 3.4, colour: i % 2 === 0 ? "#1c1814" : "#3a2e3a", amp: 1.5 });
}

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
  // New here: a hand-lettered card taped to the tank.
  v.at({ translate: [x + 2, 506], rotate: 0.06 }, () => {
    blob(v, [[-26, -9], [26, -9], [26, 9], [-26, 9]], { fill: "#e8e0c8", seed: 187, line: 1, amp: 0.3 });
    v.text("FLAVOUR: YES", { x: 0, y: 0 }, { size: 6.5, fill: "#3a2a20", align: "center", valign: "middle", style: "bold" });
  });
}

function sofa(v: View, rim: Rim): void {
  for (let i = 0; i < 3; i++) {
    const x = 560 + i * 92;
    blob(v, [[x, 560], [x + 94, 560], [x + 92, 498 + (i % 2) * 6], [x + 46, 488 + (i % 2) * 6], [x + 2, 498 + (i % 2) * 6]], { fill: i === 1 ? "#93703f" : "#8c6b3e", light: "#a8844e", dark: "#5a4224", seed: 232 + i, shadeSide: "bottom", rim });
  }
  blob(v, [[548, 616], [848, 616], [852, 548], [544, 548]], { fill: "#86653a", light: "#a8844e", dark: "#4a3820", seed: 240, shadeSide: "bottom" });
  for (const [a, b] of [[524, 566], [830, 872]] as const) {
    blob(v, [[a + 4, 616], [b - 4, 616], [b, 522], [(a + b) / 2, 508], [a, 522]], { fill: "#7a5c34", light: "#93703f", dark: "#4a3820", seed: 241 + a, shadeSide: "right", rim });
  }
  blob(v, [[640, 572], [672, 570], [670, 598], [642, 600]], { fill: "#5a6a4a", seed: 245, line: 1.4 });
  for (let i = 0; i < 7; i++) v.line(640 + i * 5, 571, 641 + i * 5, 575, { stroke: "#e8dcc0", weight: 1 });
  for (const lx of [560, 830]) blob(v, roundRectPts(lx, 614, 12, 10, 3), { fill: "#2a1e14", seed: 246 + lx, line: 1.2, amp: 0.3 });
}

/** The sitter: head and shoulders over the sofa's back, dark against the screens. */
function sitter(v: View, rim: Rim): void {
  v.clip([[0, 0], [1280, 0], [1280, 494], [0, 494]], () => {
    blob(v, ellipsePts(664, 486, 44, 28), { fill: "#1e2436", light: "#2c3550", seed: 230, line: 2.4, rim });
    blob(v, ellipsePts(668, 446, 20, 23), { fill: "#1a120e", light: "#2a1e16", seed: 231, line: 2.4, rim });
    stroke(v, [[660, 425], [656, 416]], { seed: 232, weight: 2 });
    stroke(v, [[668, 423], [669, 413]], { seed: 233, weight: 2 });
  });
}

// --- Copied from intra-lounge-side/live-tea.ts (the pictures, per frame) -------------------------

const PERIOD = 144;
type RGB = readonly [number, number, number];
const SHOW: Record<Telly["show"], RGB> = {
  text: [86, 255, 142], bars: [255, 180, 70], scope: [100, 244, 255], hex: [214, 230, 255], roll: [74, 116, 255], static: [200, 200, 208], map: [125, 255, 200],
};
function state(i: number, t: number): { rgb: RGB; level: number; error: boolean } {
  const tl = TELLIES[i];
  const p = t % PERIOD;
  const error = (i === 4 && p >= 40 && p < 64 && Math.floor(t / 4) % 2 === 0) || (i === 7 && p >= 100 && p < 128);
  if (!tl) return { rgb: [0, 0, 0], level: 0, error };
  const a = (2 * Math.PI * p) / PERIOD;
  let level = 0.8 + 0.1 * Math.sin(a * (1 + (i % 3)) + i) + 0.06 * Math.sin(a * 9 + i * 2.3);
  if (hash(i, Math.floor(t / 2), 9) < 0.05) level *= 0.5;
  if (tl.show === "static") level = 0.55 + hash(i, t, 11) * 0.35;
  return { rgb: error ? [255, 58, 48] : SHOW[tl.show], level: error ? 1.2 : level, error };
}
function glyphs(v: View, a: { x: number; y: number; w: number; h: number; colour: string; rows: number; seed: number; shift: number }): void {
  const lh = a.h / a.rows, gw = lh * 0.6;
  for (let row = 0; row < a.rows; row++) {
    const len = Math.floor(hash(a.seed, row + a.shift, 1) * (a.w / gw - 1));
    for (let c = 0; c < len; c++) {
      if (hash(a.seed * 31 + c, row + a.shift, 2) < 0.25) continue;
      v.rect(a.x + 3 + c * gw, a.y + 3 + row * lh, gw * 0.65, lh * 0.55, { fill: a.colour });
    }
  }
}
function picture(v: View, tl: Telly, i: number, t: number): void {
  const s = screenOf(tl);
  const { x, y, w, h } = s;
  const st = state(i, t);
  const col = rgba(st.rgb, 1);
  v.mask(() => v.roundRect(x, y, w, h, Math.min(w, h) * 0.22, { fill: "#000" }), () => {
    if (st.error) {
      v.rect(x, y, w, h, { fill: "#5a0a0a" });
      v.roundRect(x + w * 0.1, y + h * 0.3, w * 0.8, h * 0.4, 3, { fill: col });
      v.text("ERROR", { x: x + w / 2, y: y + h / 2 }, { size: Math.max(7, h * 0.2), fill: "#2a0000", align: "center", valign: "middle", style: "bold" });
      return;
    }
    v.rect(x, y, w, h, { fill: rgba([st.rgb[0] * 0.12, st.rgb[1] * 0.12, st.rgb[2] * 0.12], 1) });
    switch (tl.show) {
      case "text": glyphs(v, { ...s, colour: col, rows: 8, seed: i, shift: Math.floor(t / 3) }); break;
      case "hex": glyphs(v, { ...s, colour: col, rows: 6, seed: i * 7, shift: Math.floor(t / 40) }); break;
      case "bars":
        for (let b = 0; b < 7; b++) {
          const bh = (0.2 + 0.7 * Math.abs(Math.sin(t * 0.07 * (1 + (b % 3)) + b * 1.7))) * h * 0.8;
          v.rect(x + 4 + b * ((w - 8) / 7), y + h - 4 - bh, ((w - 8) / 7) * 0.7, bh, { fill: col });
        }
        break;
      case "scope": {
        const pts: Vec2[] = [];
        for (let k = 0; k <= 30; k++) pts.push([x + (k / 30) * w, y + h * (0.5 + Math.sin((k / 30) * 13 + t * 0.25) * 0.3)]);
        v.curve(pts, false, { stroke: col, weight: 1.8 });
        break;
      }
      case "roll":
        v.rect(x, y, w, h, { fill: "#1a2a9a" });
        glyphs(v, { ...s, colour: "#dfe6ff", rows: 5, seed: i * 3, shift: 0 });
        v.rect(x, y + ((t * 1.4) % (h + 14)) - 7, w, 6, { fill: "rgba(200,215,255,0.55)" });
        break;
      case "static": {
        const cell = Math.max(3, w / 18);
        for (let yy = 0; yy < h; yy += cell) for (let xx = 0; xx < w; xx += cell) {
          const g = Math.floor(hash(Math.floor(xx), Math.floor(yy) + t * 101, 17) * 200);
          v.rect(x + xx, y + yy, cell, cell, { fill: `rgb(${g},${g},${g + 10})` });
        }
        break;
      }
      case "map": {
        const ang = t * 0.09;
        v.line(x + w / 2, y + h / 2, x + w / 2 + Math.cos(ang) * w * 0.55, y + h / 2 + Math.sin(ang) * h * 0.55, { stroke: col, weight: 1.4 });
        for (let b = 0; b < 4; b++) v.circle(x + w * (0.2 + hash(i, b, 3) * 0.6), y + h * (0.2 + hash(i, b, 4) * 0.6), 1.8, { fill: col });
        break;
      }
    }
    for (let yy = y; yy < y + h; yy += 2.5) v.line(x, yy, x + w, yy, { stroke: "rgba(0,0,0,0.25)", weight: 0.8 });
    v.rect(x, y, w, h, { fill: v.ellipseGradient(x + w / 2, y + h / 2, w * 0.62, h * 0.62, [[0.55, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,0.6)"]]) });
    v.rect(x, y, w, h, { fill: `rgba(0,0,0,${(0.9 - Math.min(0.9, st.level * 0.8)).toFixed(3)})` });
  });
  v.ellipse(x + w / 2, y + h / 2, w * 0.95, h * 0.95, { fill: v.ellipseGradient(x + w / 2, y + h / 2, w * 0.95, h * 0.95, [[0, rgba(st.rgb, 0.28 * st.level)], [1, rgba(st.rgb, 0)]]), blend: "screen" });
}

function reels(v: View, t: number): void {
  v.at({ translate: [280, FLOOR], rotate: -0.025 }, () => v.at({ translate: [-280, -FLOOR] }, () => {
    for (const [k, cx] of [228, 300].entries()) {
      const turn = (Math.floor(t / 3) * 0.45 + k) * (k === 0 ? 1 : -1);
      for (let s = 0; s < 3; s++) {
        const a = turn + (s / 3) * Math.PI * 2;
        v.line(cx, 486, cx + Math.cos(a) * 22, 486 + Math.sin(a) * 22, { stroke: "#9a9488", weight: 3 });
      }
      v.circle(cx, 486, 5, { fill: "#c8c0b0" });
      v.circle(cx, 486, 5, ink(950 + k, 1));
    }
    for (let i = 0; i < 8; i++) {
      if (hash(i, Math.floor(t / (4 + i * 3)), 83) > 0.6) continue;
      const c: RGB = i % 4 === 3 ? [255, 80, 60] : i % 3 === 0 ? [255, 176, 58] : [77, 255, 122];
      const lx = 200 + i * 20, ly = 532;
      v.circle(lx, ly, 6, { fill: v.radialGradient(lx, ly, 6, [[0, rgba(c, 0.7)], [1, rgba(c, 0)]]), blend: "screen" });
      v.circle(lx, ly, 2, { fill: rgba(c, 1) });
    }
  }));
}

function vendingWindow(v: View, t: number): void {
  const hum = 0.9 + 0.06 * Math.sin(t * 2.1) + (hash(t, 0, 13) < 0.02 ? -0.3 : 0);
  const vx = VENDING.x;
  v.mask(() => v.roundRect(vx - 30, 388, 44, 96, 15, { fill: "#000" }), () => {
    v.rect(vx - 34, 384, 52, 104, { fill: rgba([205, 230, 255], hum) });
    const drinks = ["#e85a5a", "#5ad1e8", "#e8d35a", "#a05ae8", "#5ae87a"];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 2; c++) v.roundRect(vx - 22 + c * 18, 396 + r * 18, 12, 13, 3, { fill: drinks[(r * 2 + c) % drinks.length] ?? "#fff" });
  });
  v.ellipse(vx - 8, 436, 130, 110, { fill: v.ellipseGradient(vx - 8, 436, 130, 110, [[0, rgba([190, 220, 255], 0.2 * hum)], [1, rgba([190, 220, 255], 0)]]), blend: "screen" });
}

// --- The room in the kit ---------------------------------------------------------------------

function wallPieces(v: View): void {
  pipe(v, [[0, 2.8], [1.1, 2.78], [1.9, 2.82], [2.1, 2.6], [2.15, 2.25], [2.3, 2.15], [6.0, 2.15], [6.15, 2.0], [8.8, 2.0]], { seed: 6000 });
  const [gx, gy] = at(5.6, 2.15, 0);
  blob(v, ellipsePts(gx, gy - 24, 14, 14), { fill: "#d8ccb0", seed: 6001, line: 2 });
  v.line(gx, gy - 24, gx + 9, gy - 32, { stroke: "#8a2e22", weight: 1.6 });
  poster(v, 7.75, "trust", { h: 1.5 });
  amaSpeaker(v, 7.15, 2.6);
  placed(v, PLACES.shelves, () => shelves(v, rimFor(PLACES.shelves)));
  placed(v, PLACES.cabinet, () => cabinet(v, rimFor(PLACES.cabinet)));
  placed(v, PLACES.tellies, () => {
    for (const [i, tl] of TELLIES.entries()) leaning(v, tl, () => telly(v, tl, 500 + i * 20, rimFor(PLACES.tellies)));
  });
  placed(v, PLACES.vending, () => vending(v, rimFor(PLACES.vending)));
}

function furniture(v: View): void {
  // The frayed rug under the sofa.
  const [rx, ry] = at(4.5, 0, 1.25);
  blob(v, ellipsePts(rx, ry, m(1.75), 24, 30), { fill: "#6e3d36", light: "#8a5246", dark: "#4a2622", seed: 6100, amp: 1.5 });
  v.curve(wobble(ellipsePts(rx, ry, m(1.55), 17, 28), { seed: 6101, amp: 1 }), true, { stroke: "#b8925c", weight: 2.2, brush: { preset: "chalk", opacity: 0.7 }, gesture: { seed: 6101 } });
  placed(v, PLACES.sofa, () => sofa(v, rimFor(PLACES.sofa)));
}

export const ARCHIVE_LOUNGE: RoomSpec = {
  id: "archive-lounge",
  name: "Archive Lounge",
  width: 8.8,
  wall: "#3b82f6",
  trim: "#2a3a5a",
  sky: "pixel-blue",
  dead: [2],
  floor: "planks",
  ambient: "#8a90b0",
  exits: [
    { to: "Hollow Atrium", kind: "edge-left", label: "Hollow Atrium", glow: "#f97316" },
    { to: "Tranquil Pool", kind: "edge-right", label: "Tranquil Pool", glow: "#ec4899" },
    { to: "Archive Console", kind: "ladder", x: 2.45, label: "Archive Console", glow: "#ff7ac8" },
  ],
  paintWall: wallPieces,
  paintFurniture: furniture,
  rim: { x: SCREENS.x, y: SCREENS.y, colour: SCREENS.colour, reach: SCREENS.reach },
  live: (v, t) => {
    for (const [i, tl] of TELLIES.entries()) {
      const st = state(i, t);
      const s = screenOf(tl);
      const [gx, gy] = onScreen(PLACES.tellies, [s.x + s.w / 2, s.y + s.h / 2 + 60]);
      const r = (160 + tl.w) * PLACES.tellies.s;
      v.ellipse(gx, gy, r, r * 0.8, { fill: v.ellipseGradient(gx, gy, r, r * 0.8, [[0, rgba(st.rgb, 0.2 * st.level)], [1, rgba(st.rgb, 0)]]), blend: "screen" });
    }
    placed(v, PLACES.tellies, () => {
      for (const [i, tl] of TELLIES.entries()) leaning(v, tl, () => picture(v, tl, i, t));
    });
    v.cache("archive-lounge-sitter", () => placed(v, PLACES.sofa, () => sitter(v, rimFor(PLACES.sofa))));
    placed(v, PLACES.shelves, () => reels(v, t));
    placed(v, PLACES.vending, () => vendingWindow(v, t));
    // The bare bulb, mostly dead, sometimes catching.
    bareBulb(v, 3.3, 2.2, 3.0);
    if (hash(Math.floor(t / 2), 0, 61) < 0.18) {
      const [bx, by] = at(3.3, 2.2, PLANES.sofa);
      glow(v, bx, by, { rx: 60, colour: "#ffdc96", alpha: 0.6 });
    }
    amaEye(v, 7.15, 2.6, t);
    const w = pacing(t, 0.5, 8.3, 0.009);
    citizen(v, { x: w.x, facing: w.facing, pose: "walk", suit: "#5a3440", collar: "#3b82f6", number: "44", hair: "#2e1d15" }, t);
  },
};

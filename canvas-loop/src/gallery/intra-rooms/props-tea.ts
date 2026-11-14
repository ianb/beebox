// Props shared by the rooms, all sized in metres from sizes-tea.ts and drawn in the
// kit's hand. x is metres from the room's left; depth is metres out from the back
// wall; h is metres above the floor.
import type { Vec2, View } from "@ianbicking/canvas-loop";
import { INK, at, blob, ellipsePts, glow, hash, ink, mixHex, rivet, roundRectPts, stroke } from "./kit-tea.js";
import { BACK_FOOT_Y, PLANES, footY, m } from "./sizes-tea.js";

// --- On the walls --------------------------------------------------------------------------

/** Ama's intercom: a round grille with an eye in it. She is in every room. */
export function amaSpeaker(v: View, x: number, h: number): void {
  const [cx, cy] = at(x, h, 0);
  blob(v, ellipsePts(cx, cy, 24, 24), { fill: "#c8c0b0", light: "#e8e0d0", dark: "#7a7468", seed: 900, line: 2.2 });
  for (let i = -3; i <= 3; i++) stroke(v, [[cx - 16 + Math.abs(i), cy + i * 5], [cx + 16 - Math.abs(i), cy + i * 5]], { seed: 901 + i, weight: 1.4, amp: 0.2 });
  blob(v, ellipsePts(cx, cy, 8, 8), { fill: "#2a1a1a", seed: 908, line: 1.6 });
  v.text("AMA", { x: cx, y: cy + 34 }, { size: 8, fill: "#3a3028", align: "center", valign: "middle", style: "bold" });
}
/** Ama's eye, glowing: brighter when she is talking. */
export function amaEye(v: View, x: number, h: number, t: number): void {
  const [cx, cy] = at(x, h, 0);
  const talking = Math.floor(t / 90) % 3 === 0;
  const k = talking ? 0.6 + 0.4 * Math.abs(Math.sin(t * 0.4)) : 0.35 + 0.1 * Math.sin(t * 0.05);
  v.circle(cx, cy, 5, { fill: `rgba(255,60,40,${k.toFixed(3)})` });
  glow(v, cx, cy, { rx: 26, colour: "#ff4030", alpha: 0.35 * k });
}

export type PosterKind = "happiness" | "trust" | "thumbs" | "clearance" | "recreation" | "surface" | "report" | "fresh" | "smile" | "calm";
const POSTERS: Record<PosterKind, { bg: string; ink: string; lines: readonly string[] }> = {
  happiness: { bg: "#e8c84a", ink: "#3a2010", lines: ["HAPPINESS", "IS", "MANDATORY"] },
  trust: { bg: "#c84a3a", ink: "#f8f0e0", lines: ["TRUST AMA", "SHE TRUSTS", "YOU"] },
  thumbs: { bg: "#4a8ac8", ink: "#f8f0d8", lines: ["STAY", "CHEERFUL,", "CITIZEN!"] },
  clearance: { bg: "#1a1a1a", ink: "#e84a3a", lines: ["CLEARANCE", "INFRARED", "AND ABOVE"] },
  recreation: { bg: "#e8783a", ink: "#2a1a10", lines: ["RECREATION", "IS", "PRODUCTIVE"] },
  surface: { bg: "#7ac8a8", ink: "#1a3028", lines: ["THE SURFACE", "IS PERFECT.", "STAY INSIDE."] },
  report: { bg: "#e8e0c8", ink: "#8a1a1a", lines: ["REPORT", "UNHAPPINESS", "TO AMA"] },
  fresh: { bg: "#f8f048", ink: "#d02a2a", lines: ["NEW!", "IMPROVED!"] },
  smile: { bg: "#f0a8c8", ink: "#3a1a2a", lines: ["A SMILE", "IS A", "SIGNAL"] },
  calm: { bg: "#a8b8e8", ink: "#1a2040", lines: ["REMAIN", "CALM.", "THIS IS FINE."] },
};

/** A poster on the wall: faded, a corner curling, held with tape. */
export function poster(v: View, x: number, kind: PosterKind, a: { h?: number; seed?: number } = {}): void {
  const p = POSTERS[kind];
  const seed = a.seed ?? x * 13;
  const [cx, cy] = at(x, a.h ?? 1.6, 0);
  const w = m(0.6), h = m(0.82);
  v.at({ translate: [cx, cy], rotate: (hash(seed, 0, 1) - 0.5) * 0.08 }, () => {
    blob(v, [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2 - 14], [w / 2 - 14, h / 2], [-w / 2, h / 2]], { fill: mixHex(p.bg, "#d8d0c0", 0.3), dark: mixHex(p.bg, "#000000", 0.3), seed, line: 1.8 });
    v.polygon([[w / 2, h / 2 - 14], [w / 2 - 14, h / 2], [w / 2 - 12, h / 2 - 12]], { fill: "#d8d0c0" });
    if (kind === "thumbs" || kind === "smile" || kind === "happiness") {
      // The cheerful face: a round head, a grin, a thumb.
      const fy = -h * 0.22;
      blob(v, ellipsePts(0, fy, 20, 20), { fill: "#f8e0b8", seed: seed + 1, line: 1.6 });
      v.circle(-7, fy - 4, 2, { fill: INK });
      v.circle(7, fy - 4, 2, { fill: INK });
      v.arc(0, fy + 2, 10, 0.2, Math.PI - 0.2, { stroke: INK, weight: 2 });
      if (kind === "thumbs") blob(v, roundRectPts(18, fy - 4, 12, 20, 4), { fill: "#f8e0b8", seed: seed + 2, line: 1.4 });
    } else if (kind === "trust") {
      blob(v, ellipsePts(0, -h * 0.22, 26, 14), { fill: "#f8f0e0", seed: seed + 1, line: 1.6 });
      v.circle(0, -h * 0.22, 8, { fill: "#2a1010" });
      v.circle(0, -h * 0.22, 3, { fill: "#ff4030" });
    }
    const top = kind === "thumbs" || kind === "smile" || kind === "happiness" || kind === "trust" ? h * 0.06 : -h * 0.2;
    for (const [i, line] of p.lines.entries()) v.text(line, { x: 0, y: top + i * 17 }, { size: 12, fill: p.ink, align: "center", valign: "middle", style: "bold", font: "Helvetica, Arial, sans-serif" });
    v.at({ translate: [-w / 2 + 6, -h / 2 + 2], rotate: -0.6 }, () => v.rect(-10, -4, 20, 8, { fill: "rgba(230,220,180,0.8)" }));
    v.at({ translate: [w / 2 - 6, -h / 2 + 2], rotate: 0.6 }, () => v.rect(-10, -4, 20, 8, { fill: "rgba(230,220,180,0.8)" }));
  });
}

/** A ventilation grille. */
export function vent(v: View, x: number, h: number, w = 0.6): void {
  const [cx, cy] = at(x, h, 0);
  blob(v, roundRectPts(cx - m(w) / 2, cy - 18, m(w), 36, 5), { fill: "#8a8a8e", dark: "#4a4a4e", seed: 910 + x, line: 2 });
  for (let i = 0; i < 5; i++) stroke(v, [[cx - m(w) / 2 + 8, cy - 12 + i * 6], [cx + m(w) / 2 - 8, cy - 12 + i * 6]], { seed: 911 + i + x, weight: 2, colour: "#2a2a2e", amp: 0.2 });
}

/** A run of pipe along the wall: points as [x, h] in metres. */
export function pipe(v: View, pts: readonly (readonly [number, number])[], a: { width?: number; colour?: string; seed?: number } = {}): void {
  const run = pts.map(([x, h]) => at(x, h, 0));
  const t = v.tube(run, { width: m(a.width ?? 0.11) });
  const c = a.colour ?? "#7a6650";
  v.path(t, { fill: c });
  stroke(v, run.map(([x, y]): Vec2 => [x, y - m(a.width ?? 0.11) * 0.25]), { seed: (a.seed ?? 920) + 1, weight: 2.5, colour: mixHex(c, "#ffffff", 0.35), amp: 0.5 });
  v.path(t, ink(a.seed ?? 920, 2));
  for (const [i, [x, y]] of run.entries()) if (i > 0 && i < run.length - 1) blob(v, roundRectPts(x - 6, y - m(a.width ?? 0.11) * 0.75, 12, m(a.width ?? 0.11) * 1.5, 3), { fill: mixHex(c, "#000000", 0.25), seed: (a.seed ?? 920) + 2 + i, line: 1.4, amp: 0.3 });
}

/** A wall clock, stuck at some time. */
export function clock(v: View, x: number, h: number, time: number): void {
  const [cx, cy] = at(x, h, 0);
  blob(v, ellipsePts(cx, cy, 20, 20), { fill: "#f0e8d8", seed: 930 + x, line: 2.4 });
  for (let k = 0; k < 12; k++) v.line(cx + Math.cos((k / 12) * Math.PI * 2) * 15, cy + Math.sin((k / 12) * Math.PI * 2) * 15, cx + Math.cos((k / 12) * Math.PI * 2) * 17, cy + Math.sin((k / 12) * Math.PI * 2) * 17, { stroke: INK, weight: 1 });
  const hr = (time / 12) * Math.PI * 2 - Math.PI / 2, mn = (time % 1) * Math.PI * 2 - Math.PI / 2;
  v.line(cx, cy, cx + Math.cos(hr) * 9, cy + Math.sin(hr) * 9, { stroke: INK, weight: 2 });
  v.line(cx, cy, cx + Math.cos(mn) * 14, cy + Math.sin(mn) * 14, { stroke: INK, weight: 1.2 });
}

/** Faded bunting strung along the wall: someone tried to make it festive. */
export function bunting(v: View, x0: number, x1: number, h: number, colours: readonly string[] = ["#d84a3a", "#e8b83a", "#3a8ac8", "#5aa84a"]): void {
  const [ax, ay] = at(x0, h, 0), [bx] = at(x1, h, 0);
  const sag = 30;
  const curve = (u: number): Vec2 => [ax + (bx - ax) * u, ay + Math.sin(u * Math.PI) * sag];
  stroke(v, Array.from({ length: 9 }, (_, i) => curve(i / 8)), { seed: 940 + x0, weight: 1.2 });
  const n = Math.floor((bx - ax) / 34);
  for (let i = 0; i < n; i++) {
    const [px, py] = curve((i + 0.5) / n);
    if (hash(i, 0, 941 + x0) < 0.12) continue; // one fell off
    blob(v, [[px - 11, py], [px + 11, py], [px, py + 22]], { fill: mixHex(colours[i % colours.length] ?? "#d84a3a", "#c8c0b0", 0.4), seed: 942 + i, line: 1.2, amp: 0.4 });
  }
}

/** A wall-mounted fluorescent tube. */
export function tubeLight(v: View, x: number, h: number, w = 1.2): void {
  const [cx, cy] = at(x, h, 0);
  blob(v, roundRectPts(cx - m(w) / 2, cy - 7, m(w), 14, 6), { fill: "#c8c8c0", seed: 950 + x, line: 1.8 });
  v.rect(cx - m(w) / 2 + 6, cy - 2, m(w) - 12, 4, { fill: "#f0f0e0" });
}
export function tubeGlow(v: View, x: number, h: number, t: number, a: { w?: number; colour?: string; flicker?: boolean } = {}): void {
  const [cx, cy] = at(x, h, 0);
  const off = a.flicker === true && hash(Math.floor(t / 2), Math.floor(x * 10), 951) < 0.2;
  if (off) return;
  glow(v, cx, cy + 20, { rx: m(a.w ?? 1.2) * 0.9, ry: 90, colour: a.colour ?? "#e8f0ff", alpha: 0.32 });
}

// --- Hanging from the ceiling ---------------------------------------------------------------

/** A 70s globe lamp on a cord, hanging to height h. */
export function globeLamp(v: View, x: number, h: number, ceilingH: number, colour = "#f0a040"): void {
  const [cx, cy] = at(x, h, PLANES.sofa);
  const [, top] = at(x, ceilingH, 0);
  stroke(v, [[cx, top], [cx + 2, (top + cy) / 2], [cx, cy - 22]], { seed: 960 + x, weight: 1.6 });
  blob(v, ellipsePts(cx, cy, 22, 22), { fill: colour, light: mixHex(colour, "#ffffff", 0.4), dark: mixHex(colour, "#000000", 0.3), seed: 961 + x, line: 2 });
  blob(v, ellipsePts(cx, cy + 12, 12, 5), { fill: "#fff0c0", seed: 962 + x, line: 1.2 });
}
export function lampGlow(v: View, x: number, h: number, colour = "#ffb060", alpha = 0.4): void {
  const [cx, cy] = at(x, h, PLANES.sofa);
  glow(v, cx, cy + 40, { rx: 140, ry: 160, colour, alpha });
}

// --- Furniture -------------------------------------------------------------------------------

/** A 70s shell chair on a pedestal, seen from the side, facing left or right. */
export function shellChair(v: View, x: number, depth: number, a: { colour?: string; facing?: 1 | -1; seed?: number } = {}): void {
  const c = a.colour ?? "#e86a2a", f = a.facing ?? 1, seed = a.seed ?? x * 7;
  const [px, py] = at(x, 0, depth);
  blob(v, ellipsePts(px, py - 3, m(0.24), 5), { fill: "#a8a8ac", seed, line: 1.6 });
  stroke(v, [[px, py - 4], [px, py - m(0.4)]], { seed: seed + 1, weight: 4, colour: "#b8b8bc" });
  const shell: Vec2[] = [[px - f * m(0.28), py - m(0.4)], [px + f * m(0.3), py - m(0.42)], [px + f * m(0.3), py - m(0.5)], [px - f * m(0.12), py - m(0.5)], [px - f * m(0.24), py - m(0.95)], [px - f * m(0.34), py - m(0.9)], [px - f * m(0.36), py - m(0.5)]];
  blob(v, shell, { fill: c, light: mixHex(c, "#ffffff", 0.35), dark: mixHex(c, "#000000", 0.35), seed: seed + 2, line: 2.2 });
  blob(v, [[px - f * m(0.1), py - m(0.5)], [px + f * m(0.26), py - m(0.5)], [px + f * m(0.24), py - m(0.56)], [px - f * m(0.08), py - m(0.58)]], { fill: "#e8dcc0", seed: seed + 3, line: 1.4 });
}

/** A tulip table: one stem, a round top. */
export function tulipTable(v: View, x: number, depth: number, a: { w?: number; h?: number; colour?: string; seed?: number } = {}): void {
  const w = m(a.w ?? 0.8), h = m(a.h ?? 0.72), c = a.colour ?? "#e8e0d0", seed = a.seed ?? x * 11;
  const [px, py] = at(x, 0, depth);
  blob(v, ellipsePts(px, py - 3, w * 0.35, 6), { fill: c, seed, line: 1.6 });
  blob(v, [[px - 7, py - 4], [px + 7, py - 4], [px + 4, py - h + 6], [px - 4, py - h + 6]], { fill: c, seed: seed + 1, line: 1.6 });
  blob(v, ellipsePts(px, py - h, w / 2, 9), { fill: c, light: "#ffffff", dark: mixHex(c, "#000000", 0.25), seed: seed + 2, line: 2 });
}

/** A plain bench. */
export function bench(v: View, x: number, depth: number, a: { w?: number; colour?: string; seed?: number } = {}): void {
  const w = m(a.w ?? 1.6), c = a.colour ?? "#8a6a4a", seed = a.seed ?? x * 5;
  const [px, py] = at(x, 0, depth);
  blob(v, roundRectPts(px - w / 2, py - m(0.47), w, m(0.08), 4), { fill: c, light: mixHex(c, "#ffffff", 0.3), seed, line: 2 });
  for (const lx of [px - w / 2 + 14, px + w / 2 - 22]) blob(v, roundRectPts(lx, py - m(0.4), 8, m(0.4), 2), { fill: "#3a3a3e", seed: seed + lx, line: 1.4 });
}

/** A couch seen from the back (facing the wall) or the front (facing us). */
export function couch(v: View, x: number, depth: number, a: { w?: number; colour?: string; facing: "wall" | "us"; seed?: number }): void {
  const w = m(a.w ?? 2.0), c = a.colour ?? "#8c6b3e", seed = a.seed ?? x * 3;
  const [px, py] = at(x, 0, depth);
  const back = a.facing === "wall";
  const armH = m(0.62), backH = m(0.85), seatH = m(0.45);
  const lo = mixHex(c, "#000000", 0.3), hi = mixHex(c, "#ffffff", 0.25);
  if (!back) {
    blob(v, [[px - w / 2, py - seatH], [px + w / 2, py - seatH], [px + w / 2 - 4, py - backH], [px, py - backH - 6], [px - w / 2 + 4, py - backH]], { fill: lo, light: c, seed, line: 2.2 });
    for (let i = 0; i < 3; i++) blob(v, roundRectPts(px - w / 2 + 6 + i * ((w - 12) / 3), py - seatH - 16, (w - 12) / 3 - 4, 22, 8), { fill: c, light: hi, seed: seed + 1 + i, line: 1.8 });
  }
  blob(v, roundRectPts(px - w / 2, py - seatH + 4, w, seatH - 10, 8), { fill: c, light: hi, dark: lo, seed: seed + 5, line: 2.2, shadeSide: "bottom" });
  if (back) {
    for (let i = 0; i < 3; i++) {
      const cx = px - w / 2 + 4 + i * ((w - 8) / 3);
      blob(v, [[cx, py - 8], [cx + (w - 8) / 3, py - 8], [cx + (w - 8) / 3 - 2, py - backH + 8], [cx + (w - 8) / 6, py - backH], [cx + 2, py - backH + 8]], { fill: i === 1 ? hi : c, light: hi, dark: lo, seed: seed + 6 + i, line: 2, shadeSide: "bottom" });
    }
  }
  for (const ax of [px - w / 2 - m(0.22), px + w / 2]) blob(v, [[ax + 2, py - 6], [ax + m(0.22) - 2, py - 6], [ax + m(0.22), py - armH + 10], [ax + m(0.11), py - armH], [ax, py - armH + 10]], { fill: mixHex(c, "#000000", 0.12), light: hi, dark: lo, seed: seed + 10 + ax, line: 2.2 });
  for (const lx of [px - w / 2 + 6, px + w / 2 - 18]) blob(v, roundRectPts(lx, py - 8, 12, 9, 3), { fill: "#2a1e14", seed: seed + 20 + lx, line: 1.2, amp: 0.3 });
}

/** A crate, a cabinet: a plain box with a lid line. */
export function crate(v: View, x: number, depth: number, a: { w: number; h: number; colour?: string; seed?: number }): void {
  const [px, py] = at(x, 0, depth);
  const c = a.colour ?? "#8a6a42";
  blob(v, [[px - m(a.w) / 2, py], [px + m(a.w) / 2, py], [px + m(a.w) / 2, py - m(a.h)], [px - m(a.w) / 2, py - m(a.h)]], { fill: c, light: mixHex(c, "#ffffff", 0.25), dark: mixHex(c, "#000000", 0.35), seed: a.seed ?? x * 17, line: 2.2, shadeSide: "right" });
  stroke(v, [[px - m(a.w) / 2 + 4, py - m(a.h) + 10], [px + m(a.w) / 2 - 4, py - m(a.h) + 10]], { seed: (a.seed ?? x * 17) + 1, weight: 1.4, amp: 0.4 });
}

/** A plastic plant in a pot: too green, too regular. */
export function plant(v: View, x: number, depth: number, a: { h?: number; leaf?: string; pot?: string; seed?: number } = {}): void {
  const [px, py] = at(x, 0, depth);
  const h = m(a.h ?? 1.1), leaf = a.leaf ?? "#3ac85a", seed = a.seed ?? x * 19;
  blob(v, [[px - 18, py], [px + 18, py], [px + 24, py - 40], [px - 24, py - 40]], { fill: a.pot ?? "#e8e0d0", dark: "#8a8070", seed, line: 2 });
  for (let i = 0; i < 9; i++) {
    const ang = -Math.PI / 2 + (i - 4) * 0.32 + (hash(i, 0, seed) - 0.5) * 0.1;
    const len = h * (0.55 + hash(i, 1, seed) * 0.45);
    const tip: Vec2 = [px + Math.cos(ang) * len * 0.6, py - 40 + Math.sin(ang) * len];
    blob(v, [[px - 3, py - 40], [px + 3, py - 40], [tip[0] + 6, tip[1] + 4], tip, [tip[0] - 6, tip[1] + 4]], { fill: i % 2 === 0 ? leaf : mixHex(leaf, "#ffffff", 0.2), seed: seed + i, line: 1.4, amp: 0.5 });
  }
  // The price sticker is still on it.
  v.rect(px + 4, py - 30, 12, 8, { fill: "#f8f048" });
}

// --- CRT sets ---------------------------------------------------------------------------------

export interface Crt {
  x: number;
  /** Height its base rests at. */
  h: number;
  w: number;
  hh: number;
  depth?: number;
  body?: string;
  tilt?: number;
}
export function crtScreen(c: Crt): { x: number; y: number; w: number; h: number } {
  const [px, py] = at(c.x, c.h, c.depth ?? PLANES.wall);
  const w = m(c.w), h = m(c.hh);
  return { x: px - w / 2 + w * 0.09, y: py - h + h * 0.12, w: w * 0.68, h: h * 0.7 };
}
export function crtPivot(c: Crt): Vec2 {
  return at(c.x, c.h, c.depth ?? PLANES.wall);
}
export function leaning(v: View, c: Crt, body: () => void): void {
  const [px, py] = crtPivot(c);
  v.at({ translate: [px, py], rotate: c.tilt ?? 0 }, () => v.at({ translate: [-px, -py] }, body));
}
/** An old television set: bulging casing, knobs, a grille. Its picture is drawn per frame. */
export function crt(v: View, c: Crt, seed: number): void {
  leaning(v, c, () => {
    const [px, py] = crtPivot(c);
    const w = m(c.w), h = m(c.hh), x = px - w / 2, top = py - h;
    const body = c.body ?? "#b8ab8c";
    blob(v, [[x + 4, py], [x + w - 4, py], [x + w + 2, top + h * 0.3], [x + w - 2, top], [x + 2, top], [x - 2, top + h * 0.3]], { fill: body, light: "#ddd2b6", dark: "#5a5048", seed, shadeSide: "right", line: 2.4 });
    const s = crtScreen(c);
    blob(v, roundRectPts(s.x - 4, s.y - 4, s.w + 8, s.h + 8, Math.min(s.w, s.h) * 0.25), { fill: "#4a4038", seed: seed + 1, line: 1.6, amp: 0.6 });
    blob(v, roundRectPts(s.x, s.y, s.w, s.h, Math.min(s.w, s.h) * 0.22), { fill: "#121614", seed: seed + 2, line: 2, amp: 0.5 });
    const kx = x + w * 0.88;
    for (let k = 0; k < 2; k++) {
      v.circle(kx, top + h * (0.25 + k * 0.24), w * 0.05, { fill: "#3a302a" });
      v.circle(kx, top + h * (0.25 + k * 0.24), w * 0.05, ink(seed + 3 + k, 1.2));
    }
    for (let g = 0; g < 4; g++) stroke(v, [[kx - w * 0.05, top + h * 0.66 + g * 4], [kx + w * 0.05, top + h * 0.66 + g * 4]], { seed: seed + 10 + g, weight: 1, amp: 0.2 });
    rivet(v, x + 7, top + 7);
  });
}

// --- People ---------------------------------------------------------------------------------

export interface Citizen {
  /** Metres from the room's left. */
  x: number;
  depth?: number;
  facing?: 1 | -1;
  pose?: "walk" | "stand" | "sit";
  suit?: string;
  collar?: string;
  hair?: string;
  skin?: string;
  number?: string;
}

/** A citizen in an Intra jumpsuit, 1.65 m tall, drawn at their spot. */
export function citizen(v: View, p: Citizen, t: number): void {
  const [x, y] = at(p.x, 0, p.depth ?? PLANES.walk);
  const k = m(1.65) / 140;
  const f = p.facing ?? 1;
  const suit = p.suit ?? "#3a6a9a", collar = p.collar ?? "#e8b83a", skin = p.skin ?? "#c58a62", hair = p.hair ?? "#2e1d15";
  const step = p.pose === "walk" ? Math.sin(t * 0.3) : 0;
  const sit = p.pose === "sit";
  v.at({ translate: [x, y], scale: [f * k, k] }, () => {
    v.ellipse(0, 0, 24, 6, { fill: "rgba(0,0,0,0.4)" });
    if (sit) {
      blob(v, [[-10, -50], [24, -50], [26, -40], [-10, -38]], { fill: suit, seed: 801, line: 1.8 });
      blob(v, [[18, -48], [28, -48], [28, -2], [18, -2]], { fill: suit, seed: 802, line: 1.6 });
      blob(v, ellipsePts(26, -2, 9, 4), { fill: "#1a1410", seed: 803, line: 1.2 });
    } else {
      for (const s of [-1, 1]) {
        const sw = s * step * 10;
        blob(v, [[-5 + sw * 0.3, -62], [5 + sw * 0.3, -62], [6 + sw, -2], [-3 + sw, -2]], { fill: mixHex(suit, "#000000", 0.15), seed: 804 + s, line: 1.6, amp: 0.4 });
        blob(v, ellipsePts(sw + 5, -2, 9, 4.5, 10), { fill: "#1a1410", seed: 806 + s, line: 1.2, amp: 0.3 });
      }
    }
    const ty = sit ? 12 : 0;
    blob(v, [[-14, -58 + ty], [14, -58 + ty], [12, -112 + ty], [0, -116 + ty], [-12, -112 + ty]], { fill: suit, light: mixHex(suit, "#ffffff", 0.25), dark: mixHex(suit, "#000000", 0.3), seed: 808, shadeSide: "left", line: 2 });
    // A belt, the collar in the room colour, a number on the chest.
    stroke(v, [[-13, -66 + ty], [13, -66 + ty]], { seed: 809, weight: 3, colour: "#2a2420", amp: 0.3 });
    blob(v, [[-10, -112 + ty], [10, -112 + ty], [6, -104 + ty], [-6, -104 + ty]], { fill: collar, seed: 810, line: 1.4 });
    // The number reads the right way round whichever way they face.
    if (p.number !== undefined) v.at({ translate: [3, -92 + ty], scale: [f, 1] }, () => v.text(p.number ?? "", { x: 0, y: 0 }, { size: 7, fill: "#f0e8d0", align: "center", valign: "middle", style: "bold" }));
    blob(v, ellipsePts(2, -127 + ty, 11, 13, 14), { fill: skin, light: mixHex(skin, "#ffffff", 0.2), seed: 811, line: 1.8 });
    blob(v, [[-11, -129 + ty], [10, -138 + ty], [12, -128 + ty], [0, -141 + ty], [-10, -138 + ty]], { fill: hair, seed: 812, line: 1.4 });
    v.circle(9, -127 + ty, 1.3, { fill: "#1a1010" });
    const swing = p.pose === "walk" ? step * 4 : 0;
    blob(v, [[9, -108 + ty], [15, -104 + ty], [18 + swing, -70 + ty], [12 + swing, -68 + ty], [7, -100 + ty]], { fill: mixHex(suit, "#000000", 0.1), seed: 813, line: 1.6 });
  });
}

/** The x a walker reaches at frame t, pacing between a and b (metres), and their facing. */
export function pacing(t: number, a: number, b: number, speed = 0.009): { x: number; facing: 1 | -1 } {
  const span = b - a;
  const d = (t * speed) % (span * 2);
  return d < span ? { x: a + d, facing: 1 } : { x: b - (d - span), facing: -1 };
}

export { BACK_FOOT_Y, footY };

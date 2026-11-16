// The room kit: a room is a spec (size, colours, sky, floor, exits, props), and
// this draws its shell and exits in the shared language. Rooms add their own
// pieces through `paint` (still) and `live` (per frame).
//
// Coordinates: metres. x from the room's left edge; h up from the floor; depth out
// from the back wall (see sizes-tea.ts). `at(x, h, depth)` gives the screen point
// in the room's own pixels (before the camera pans).
import type { Drawing, Vec2, View } from "@ianbicking/canvas-loop";
import { INK, type Rim, blob, ellipsePts, hash, ink, rivet, roundRectPts, stroke, wobble } from "./ink-tea.js";
import { BACK_FOOT_Y, PLANES, VIEW_H, footY, m } from "./sizes-tea.js";

export const at = (x: number, h: number, depth: number = PLANES.wall): Vec2 => [m(x), footY(depth) - m(h)];

export type SkyKind =
  | "sunset" | "pixel-blue" | "pink-sunset" | "clouds" | "birds" | "still-clouds" | "balloons" | "night-stars"
  | "beach" | "paper-planes" | "canopy" | "shifting-stars" | "overcast" | "calm-static" | "test-card" | "dead" | "cheerful";
export type FloorKind = "planks" | "tiles" | "carpet" | "terrazzo" | "rubber" | "grate" | "lino";

export type ExitKind = "edge-left" | "edge-right" | "door" | "stairs-up" | "stairs-down" | "ladder" | "tube";
export interface Exit {
  to: string;
  kind: ExitKind;
  /** Metres from the left, for exits in the back wall. */
  x?: number;
  style?: "arch" | "slide" | "hatch" | "plain" | "bulkhead" | "open" | "closed";
  /** The light from the room beyond. */
  glow?: string;
  label?: string;
}

export interface RoomSpec {
  id: string;
  name: string;
  /** Metres. */
  width: number;
  ceiling?: number;
  /** The room's colour (intra-game's), and a trim colour. */
  wall: string;
  trim?: string;
  sky: SkyKind;
  /** Panels (by index) that are dead. */
  dead?: readonly number[];
  floor: FloorKind;
  floorColour?: string;
  exits: readonly Exit[];
  /** Ambient: the colour the room dims toward. */
  ambient?: string;
  /** A stripe of fresh paint someone started and did not finish. */
  freshPaint?: { from: number; to: number; colour: string };
  /** Room-specific still drawing: on the wall, then furniture. */
  paintWall?: (v: View) => Drawing;
  paintFurniture?: (v: View) => Drawing;
  /** Room-specific per-frame drawing, after the light. */
  live?: (v: View, t: number) => Drawing;
  /** For rooms wider than the view: the screen x (room px) the camera follows at frame t. */
  focus?: (t: number) => number;
  /** Light that paints rims (room coordinates, px). */
  rim?: Rim;
}

export function ceilingOf(r: RoomSpec): number {
  return r.ceiling ?? 3;
}

// --- Colour helpers ---------------------------------------------------------------------

export function mixHex(a: string, b: string, t: number): string {
  const pa = Number.parseInt(a.slice(1), 16), pb = Number.parseInt(b.slice(1), 16);
  const ch = (p: number, s: number): number => (p >> s) & 255;
  const c = [16, 8, 0].map((s) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t));
  return `#${c.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}
/** A room colour as worn paint: muted toward grey and a little dark. */
export function faded(c: string): string {
  return mixHex(mixHex(c, "#6a6a66", 0.55), "#2a2a30", 0.15);
}

// --- Shell --------------------------------------------------------------------------------

/** Rock around the room, past its edges and above its ceiling. */
function bedrock(v: View, r: RoomSpec): Drawing {
  const out: Drawing[] = [];
  const w = m(r.width);
  out.push(v.rect(-300, -20, w + 600, VIEW_H + 40, { fill: "#141118" }));
  for (let i = 0; i < 40; i++) {
    const x = -280 + hash(i, 0, 3) * (w + 560), y = hash(i, 1, 4) * VIEW_H;
    out.push(stroke(v, [[x, y], [x + 40 + hash(i, 2, 5) * 80, y + (hash(i, 3, 6) - 0.5) * 20]], { seed: 10 + i, weight: 1.2, colour: "#24202a", amp: 2 }));
  }
  return out;
}

function wall(v: View, r: RoomSpec): Drawing {
  const out: Drawing[] = [];
  const w = m(r.width), top = BACK_FOOT_Y - m(ceilingOf(r));
  const paint = faded(r.wall);
  out.push(blob(v, [[0, BACK_FOOT_Y], [w, BACK_FOOT_Y], [w, top], [w / 2, top + 4], [0, top]], { fill: paint, light: mixHex(paint, "#ffffff", 0.18), dark: mixHex(paint, "#000000", 0.25), seed: 20, amp: 2.5 }));
  // Stains from the ceiling, cracks, a patch of filler.
  for (let i = 0; i < Math.ceil(r.width * 1.2); i++) {
    const x = 40 + hash(i, 0, 21) * (w - 80);
    out.push(stroke(v, [[x, top + 4], [x + 3, top + 50 + hash(i, 1, 22) * 140]], { seed: 30 + i, weight: 8, colour: "rgba(40,40,40,0.22)", amp: 2.5 }));
  }
  for (let i = 0; i < Math.ceil(r.width / 2.5); i++) {
    const x = 80 + hash(i, 2, 23) * (w - 160), y = top + 80 + hash(i, 3, 24) * 180;
    out.push(stroke(v, [[x, y], [x + 14, y + 20], [x + 6, y + 38], [x + 20, y + 58]], { seed: 50 + i, weight: 1.2, amp: 1.2 }));
    if (i % 2 === 0) {
      // Tape across the crack.
      out.push(v.at({ translate: [x + 10, y + 30], rotate: 0.5 }, v.rect(-14, -4, 28, 8, { fill: "rgba(230,220,180,0.75)" })));
    }
  }
  // A dado rail in the trim colour.
  const trim = r.trim ?? mixHex(r.wall, "#3a2a20", 0.5);
  out.push(blob(v, [[0, BACK_FOOT_Y - m(1.02)], [w, BACK_FOOT_Y - m(1.02)], [w, BACK_FOOT_Y - m(1.08)], [0, BACK_FOOT_Y - m(1.08)]], { fill: trim, seed: 60, line: 1.6, amp: 0.8 }));
  if (r.freshPaint) {
    // Someone started making it fresh: a bright band, ending in drips and a roller mark.
    const { from, to, colour } = r.freshPaint;
    const y0 = BACK_FOOT_Y - m(1.6), y1 = BACK_FOOT_Y - m(1.2);
    out.push(blob(v, [[m(from), y1], [m(to), y1], [m(to) + 6, (y0 + y1) / 2], [m(to) - 4, y0], [m(from), y0]], { fill: colour, seed: 61, line: 0.6, amp: 2 }));
    for (let i = 0; i < 4; i++) out.push(stroke(v, [[m(to) - 10 - i * 14, y1], [m(to) - 10 - i * 14, y1 + 10 + hash(i, 0, 62) * 20]], { seed: 63 + i, weight: 3, colour, amp: 0.5 }));
  }
  // Riveted plates along the bottom.
  const plate = mixHex("#6a5446", r.wall, 0.15);
  for (let x = 0; x < w; x += 82) {
    const e = Math.min(w, x + 82);
    out.push(blob(v, [[x, BACK_FOOT_Y], [e, BACK_FOOT_Y], [e, BACK_FOOT_Y - m(0.5)], [x, BACK_FOOT_Y - m(0.5)]], { fill: plate, light: "#86705e", dark: "#3e3028", seed: 70 + x, amp: 1, line: 1.8 }));
    for (let rx = x + 10; rx < e - 6; rx += 14) {
      out.push(rivet(v, rx, BACK_FOOT_Y - m(0.5) + 7));
      out.push(rivet(v, rx, BACK_FOOT_Y - 7));
    }
    out.push(stroke(v, [[x + 22, BACK_FOOT_Y - m(0.5) + 8], [x + 24, BACK_FOOT_Y - m(0.5) + 34]], { seed: 80 + x, weight: 4, colour: "rgba(122,58,30,0.45)", amp: 0.6 }));
  }
  return out;
}

/** The ceiling: a riveted beam holding the sky-screen panels. */
export function panels(r: RoomSpec): [number, number][] {
  const w = m(r.width);
  const n = Math.max(1, Math.round(r.width / 2.2));
  const pw = w / n;
  return Array.from({ length: n }, (_, i): [number, number] => [i * pw + 10, (i + 1) * pw - 10]);
}
export function panelBand(r: RoomSpec): [number, number] {
  const top = BACK_FOOT_Y - m(ceilingOf(r));
  return [top - 66, top - 6];
}
function ceiling(v: View, r: RoomSpec): Drawing {
  const out: Drawing[] = [];
  const w = m(r.width);
  const [y0, y1] = panelBand(r);
  out.push(blob(v, [[-10, y0 - 50], [w + 10, y0 - 50], [w + 10, y0 - 6], [w / 2, y0], [-10, y0 - 6]], { fill: "#2c2a30", dark: "#18161a", seed: 90, amp: 2 }));
  for (let x = 12; x < w; x += 36) out.push(rivet(v, x, y0 - 14));
  for (const [i, [a, b]] of panels(r).entries()) {
    const sag = 3 + (i % 3) * 2;
    out.push(blob(v, [[a - 6, y0 - 8], [b + 6, y0 - 8], [b + 6, y1 + 8], [(a + b) / 2, y1 + 8 + sag], [a - 6, y1 + 8]], { fill: "#3a363e", seed: 91 + i, line: 2.4, amp: 1.2 }));
    out.push(blob(v, [[a, y0], [b, y0], [b, y1], [(a + b) / 2, y1 + sag], [a, y1]], { fill: "#0e1018", seed: 100 + i, line: 1.6, amp: 0.8 }));
    if (r.dead?.includes(i) === true) {
      out.push(stroke(v, [[a + 40, y0 + 4], [a + 90, y0 + 30], [a + 76, y0 + 48], [a + 130, y1 - 2]], { seed: 110 + i, weight: 1.6, colour: "#6a7080" }));
      out.push(stroke(v, [[a + 90, y0 + 30], [a + 150, y0 + 18], [b - 30, y0 + 40]], { seed: 120 + i, weight: 1.2, colour: "#6a7080" }));
    }
  }
  return out;
}

const FLOORS: Record<FloorKind, string> = {
  planks: "#5a4838", tiles: "#8a5a32", carpet: "#6a4a36", terrazzo: "#9a9488", rubber: "#3e4448", grate: "#4a4a50", lino: "#7a8a6a",
};

function shag(v: View, r: RoomSpec, base: string, y0: number, y1: number): Drawing {
  const out: Drawing[] = [];
  const w = m(r.width), dark = mixHex(base, "#000000", 0.45);
  for (let i = 0; i < r.width * 60; i++) {
    const x = hash(i, 0, 160) * w, y = y0 + 4 + hash(i, 1, 161) * (y1 - y0 - 8);
    out.push(v.line(x, y, x + (hash(i, 2, 162) - 0.5) * 4, y - 3 - hash(i, 3, 163) * 3, { stroke: hash(i, 4, 164) < 0.5 ? dark : mixHex(base, "#ffffff", 0.2), weight: 1.2 }));
  }
  return out;
}
function terrazzo(v: View, r: RoomSpec, y0: number, y1: number, lines: readonly number[], dark: string): Drawing {
  const out: Drawing[] = [];
  const w = m(r.width);
  for (let i = 0; i < r.width * 50; i++) {
    const x = hash(i, 0, 170) * w, y = y0 + 3 + hash(i, 1, 171) * (y1 - y0 - 6);
    out.push(v.ellipse(x, y, 1 + hash(i, 2, 172) * 2, 0.6 + hash(i, 3, 173), { fill: ["#c8b090", "#5a5450", "#e8e0d0", "#8a6a50"][i % 4] ?? "#fff" }));
  }
  for (const y of lines.slice(1, 3)) out.push(stroke(v, [[0, y], [w, y]], { seed: 174 + y, weight: 1, colour: dark, amp: 0.6 }));
  return out;
}

function floor(v: View, r: RoomSpec): Drawing {
  const w = m(r.width), y0 = BACK_FOOT_Y - 2, y1 = footY(PLANES.front) + 8;
  const base = r.floorColour ?? FLOORS[r.floor];
  return [
    blob(v, [[-4, y0], [w + 4, y0], [w + 4, y1], [-4, y1]], { fill: base, light: mixHex(base, "#ffffff", 0.15), dark: mixHex(base, "#000000", 0.3), seed: 130, amp: 1.5 }),
    v.clip([[0, y0], [w, y0], [w, y1], [0, y1]], floorPattern(v, r, base, y0, y1)),
  ];
}

/** The floor's pattern, kept inside the room. */
function floorPattern(v: View, r: RoomSpec, base: string, y0: number, y1: number): Drawing {
  const out: Drawing[] = [];
  const w = m(r.width);
  const lines = [0.4, 0.9, 1.5, 2.2, 3.0].map((d) => footY(d));
  const dark = mixHex(base, "#000000", 0.45);
  switch (r.floor) {
    case "planks":
    case "lino":
      for (const [i, y] of lines.entries()) out.push(stroke(v, [[0, y], [w / 2, y + (hash(i, 0, 131) - 0.5) * 4], [w, y]], { seed: 132 + i, weight: 1.2, colour: dark, amp: 1.2 }));
      for (let i = 0; i < r.width * 2; i++) {
        const x = hash(i, 0, 133) * w, row = Math.floor(hash(i, 1, 134) * 4);
        out.push(stroke(v, [[x, lines[row] ?? y0], [x + 2, lines[row + 1] ?? y1]], { seed: 140 + i, weight: 1, colour: dark, amp: 0.3 }));
      }
      break;
    case "tiles":
      for (let row = 0; row < 4; row++) {
        const ya = lines[row] ?? y0, yb = lines[row + 1] ?? y1;
        const tw = 34 + row * 8;
        for (let x = (row % 2) * tw; x < w; x += tw * 2) out.push(v.polygon([[x, ya], [x + tw, ya], [x + tw + 2, yb], [x + 2, yb]], { fill: mixHex(base, "#e8c890", 0.35) }));
      }
      for (const y of lines) out.push(stroke(v, [[0, y], [w, y]], { seed: 150 + y, weight: 1, colour: dark, amp: 0.8 }));
      break;
    case "carpet": out.push(shag(v, r, base, y0, y1)); break;
    case "terrazzo": out.push(terrazzo(v, r, y0, y1, lines, dark)); break;
    case "rubber":
      for (let i = 0; i < r.width * 30; i++) out.push(v.circle(hash(i, 0, 180) * w, y0 + 4 + hash(i, 1, 181) * (y1 - y0 - 8), 1.6, { fill: dark }));
      break;
    case "grate":
      for (let x = 0; x < w; x += 14) out.push(stroke(v, [[x, y0], [x + 6, y1]], { seed: 190 + x, weight: 1.4, colour: dark, amp: 0.3 }));
      for (const y of lines) out.push(stroke(v, [[0, y], [w, y]], { seed: 195 + y, weight: 1.6, colour: dark, amp: 0.3 }));
      break;
  }
  return out;
}

/** The ends of the room: thick pillars where the side walls are cut away, unless an
 * edge exit opens there. */
function ends(v: View, r: RoomSpec): Drawing {
  const out: Drawing[] = [];
  const w = m(r.width), top = BACK_FOOT_Y - m(ceilingOf(r)) - 8;
  for (const [side, x] of [["edge-left", 0], ["edge-right", w]] as const) {
    if (r.exits.some((e) => e.kind === side)) continue;
    const dir = side === "edge-left" ? -1 : 1;
    out.push(blob(v, [[x, top], [x + dir * 26, top], [x + dir * 26, footY(PLANES.front) + 10], [x, footY(PLANES.front) + 10]], { fill: "#24212a", seed: 200 + x, line: 2.4 }));
  }
  return out;
}

// --- Exits ----------------------------------------------------------------------------------

function sign(v: View, x: number, y: number, text: string, seed: number): Drawing {
  return v.at({ translate: [x, y], rotate: (hash(seed, 0, 1) - 0.5) * 0.08 }, ((): Drawing => {
    const tw = Math.max(70, text.length * 7.4 + 18);
    return [
      stroke(v, [[-tw / 2 + 8, -26], [-tw / 2 + 12, -12]], { seed, weight: 1.2 }),
      stroke(v, [[tw / 2 - 8, -26], [tw / 2 - 12, -12]], { seed: seed + 1, weight: 1.2 }),
      blob(v, roundRectPts(-tw / 2, -13, tw, 24, 4), { fill: "#e8dcc0", seed: seed + 2, line: 1.8, amp: 0.6 }),
      v.text(text.toUpperCase(), { x: 0, y: 0 }, { size: 11, fill: "#3a2a20", align: "center", valign: "middle", style: "bold" }),
    ];
  })());
}

function backDoor(v: View, e: Exit, seed: number, foot = BACK_FOOT_Y): Drawing {
  const out: Drawing[] = [];
  const x = m(e.x ?? 1);
  const style = e.style ?? "slide";
  if (style === "arch" || style === "open") {
    const half = m(0.6), h = m(2.4);
    const pts: Vec2[] = [[x - half, foot], [x + half, foot], [x + half, foot - h + half]];
    for (let i = 0; i <= 10; i++) pts.push([x + Math.cos((i / 10) * Math.PI) * half, foot - h + half - Math.sin((i / 10) * Math.PI) * half]);
    pts.push([x - half, foot - h + half]);
    out.push(blob(v, pts.map(([px, py]): Vec2 => [x + (px - x) * 1.16, py - 10]), { fill: "#8a7a64", dark: "#4a3e32", seed, line: 2.4 }));
    out.push(v.curve(wobble(pts, { seed: seed + 1, amp: 1 }), true, { fill: "#1a1216" }));
    out.push(v.curve(wobble(pts, { seed: seed + 1, amp: 1 }), true, ink(seed + 1, 2.4)));
  } else if (style === "bulkhead" || style === "hatch") {
    const rx = m(0.5), ry = m(0.95), cy = foot - m(1.05);
    out.push(blob(v, ellipsePts(x, cy, rx + 14, ry + 14, 24), { fill: "#6a6e72", light: "#8a9094", dark: "#3a3e42", seed, line: 2.6 }));
    for (let i = 0; i < 12; i++) out.push(rivet(v, x + Math.cos((i / 12) * Math.PI * 2) * (rx + 7), cy + Math.sin((i / 12) * Math.PI * 2) * (ry + 7)));
    out.push(blob(v, ellipsePts(x, cy, rx, ry, 22), { fill: "#1a161c", seed: seed + 1, line: 2 }));
    // The wheel on the open hatch, swung aside.
    out.push(v.circle(x + rx + 30, cy, 14, { stroke: "#8a2e22", weight: 3 }));
  } else if (style === "closed") {
    // A closed door with its nameplate and an access keypad (its light is drawn per frame).
    const half = m(0.45), h = m(2.1);
    out.push(blob(v, roundRectPts(x - half - 10, foot - h - 10, half * 2 + 20, h + 10, 14), { fill: "#5a5650", light: "#7a766e", seed, line: 2.4 }));
    out.push(blob(v, roundRectPts(x - half, foot - h, half * 2, h, 10), { fill: "#9aa49a", light: "#c0c8bc", dark: "#5a645a", seed: seed + 1, line: 2.2, shadeSide: "right" }));
    for (const y of [0.35, 0.65]) out.push(stroke(v, [[x - half + 10, foot - h * y], [x + half - 10, foot - h * y]], { seed: seed + 2 + y * 10, weight: 1.4, amp: 0.4 }));
    out.push(blob(v, roundRectPts(x + half + 14, foot - m(1.3), 20, 30, 3), { fill: "#3a3a40", seed: seed + 4, line: 1.4 }));
    for (let k = 0; k < 6; k++) out.push(v.rect(x + half + 17 + (k % 3) * 5, foot - m(1.3) + 12 + Math.floor(k / 3) * 6, 3, 3, { fill: "#a8a8b0" }));
    if (e.label !== undefined) {
      out.push(blob(v, roundRectPts(x - 34, foot - h * 0.86 - 10, 68, 20, 3), { fill: "#e8dcc0", seed: seed + 5, line: 1.4 }));
      out.push(v.text(e.label.toUpperCase(), { x, y: foot - h * 0.86 }, { size: 10, fill: "#2a2018", align: "center", valign: "middle", style: "bold" }));
    }
    return out;
  } else {
    // A 70s sliding door: rounded corners, a porthole, a chrome edge; stuck half open.
    const half = m(0.45), h = m(2.1);
    out.push(blob(v, roundRectPts(x - half - 12, foot - h - 12, half * 2 + 24, h + 12, 18), { fill: "#5a5650", light: "#7a766e", seed, line: 2.4 }));
    out.push(blob(v, roundRectPts(x - half, foot - h, half * 2, h, 14), { fill: "#141018", seed: seed + 1, line: 2 }));
    if (style === "slide") {
      out.push(blob(v, roundRectPts(x - half, foot - h, half * 1.1, h, 14), { fill: "#b8a888", light: "#d8ccb0", dark: "#6a5e4e", seed: seed + 2, line: 2.2 }));
      out.push(blob(v, ellipsePts(x - half * 0.45, foot - h * 0.68, 13, 13), { fill: "#2a3a48", seed: seed + 3, line: 2 }));
      out.push(v.line(x - half + 4, foot - h * 0.4, x - half * 0.1, foot - h * 0.4, { stroke: "#e8e0d0", weight: 3 }));
    }
  }
  if (e.label !== undefined) out.push(sign(v, x, foot - m(2.45), e.label, seed + 10));
  return out;
}

function edgeExit(v: View, r: RoomSpec, e: Exit, seed: number): Drawing {
  const out: Drawing[] = [];
  const w = m(r.width), left = e.kind === "edge-left";
  const x = left ? 0 : w, dir = left ? 1 : -1;
  // A doorway in the cut-away side wall: a frame, a dark way through.
  const h = m(2.25), top = BACK_FOOT_Y - h;
  out.push(blob(v, [[x, top - 18], [x + dir * 40, top - 18], [x + dir * 40, footY(PLANES.front) + 10], [x, footY(PLANES.front) + 10]], { fill: "#24212a", seed, line: 2.4 }));
  out.push(blob(v, [[x + dir * 6, top], [x + dir * 34, top + 4], [x + dir * 34, footY(PLANES.front)], [x + dir * 6, footY(PLANES.front)]], { fill: "#120e14", seed: seed + 1, line: 1.8 }));
  // Edge signs hang a little higher than door signs (2.45 m), so the two never meet.
  if (e.label !== undefined) out.push(sign(v, x + dir * 90, BACK_FOOT_Y - m(2.62), left ? `< ${e.label}` : `${e.label} >`, seed + 10));
  return out;
}

function stairs(v: View, r: RoomSpec, e: Exit, seed: number): Drawing {
  const drawn: Drawing[] = [];
  const x = m(e.x ?? 1), up = e.kind === "stairs-up";
  const n = up ? 4 : 5, rise = m(0.18), run = m(0.28);
  if (up) {
    // A flight along the back wall to a door on a landing.
    const pts: Vec2[] = [[x, BACK_FOOT_Y]];
    for (let i = 0; i < n; i++) {
      pts.push([x + i * run, BACK_FOOT_Y - (i + 1) * rise], [x + (i + 1) * run, BACK_FOOT_Y - (i + 1) * rise]);
    }
    const lx = x + n * run, ly = BACK_FOOT_Y - n * rise;
    pts.push([lx + m(1.0), ly], [lx + m(1.0), BACK_FOOT_Y]);
    drawn.push(blob(v, pts, { fill: "#6a5a4a", light: "#8a7660", dark: "#3a2e24", seed, line: 2.4 }));
    for (let i = 0; i < n; i++) drawn.push(stroke(v, [[x + i * run, BACK_FOOT_Y - (i + 1) * rise], [x + (i + 1) * run, BACK_FOOT_Y - (i + 1) * rise]], { seed: seed + i, weight: 3, colour: "#c9a46a", amp: 0.3 }));
    // Railing, then the door on the landing.
    drawn.push(stroke(v, [[x + 8, BACK_FOOT_Y - m(0.9)], [lx + 4, ly - m(0.9)], [lx + m(0.9), ly - m(0.9)]], { seed: seed + 20, weight: 3, colour: "#9a9a9e" }));
    for (let i = 0; i <= n; i += 2) drawn.push(stroke(v, [[x + i * run + 8, BACK_FOOT_Y - i * rise - rise], [x + i * run + 8, BACK_FOOT_Y - i * rise - m(0.9)]], { seed: seed + 30 + i, weight: 1.8, colour: "#9a9a9e" }));
    drawn.push(backDoor(v, { to: e.to, kind: "door", x: (lx + m(0.5)) / m(1), style: e.style ?? "slide" }, seed + 40, ly));
    // The landing's sign hangs beside its door, clear of the ceiling.
    if (e.label !== undefined) drawn.push(sign(v, lx + m(1.4), ly - m(1.7), e.label, seed + 50));
  } else {
    // A stairwell going down, out in the floor: an opening, the first steps going
    // down into the dark, a railing round the back and far end.
    const d0 = 0.5, d1 = 1.35;
    const a = footY(d0), b = footY(d1), wide = m(1.6);
    drawn.push(blob(v, [[x, a], [x + wide, a], [x + wide, b], [x, b]], { fill: "#0c0a0e", seed, line: 2.4 }));
    for (let i = 0; i < 4; i++) {
      const sx = x + wide - 30 - i * 34, sy = a + 6 + i * 7;
      drawn.push(blob(v, [[sx - 34, sy], [sx, sy], [sx, b - 2], [sx - 34, b - 2]], { fill: i === 0 ? "#5a4a40" : "#3a3030", dark: "#1a1418", seed: seed + 1 + i, line: 1.6 }));
    }
    const rail = (pts: Vec2[]): Drawing => stroke(v, pts, { seed: seed + 20 + pts.length, weight: 4, colour: "#a8a8ae" });
    drawn.push(rail([[x - 4, a - m(0.9)], [x + wide + 4, a - m(0.9)]]));
    drawn.push(rail([[x + wide + 4, a - m(0.9)], [x + wide + 4, b - m(0.9)]]));
    for (const px of [x - 4, x + wide / 2, x + wide + 4]) drawn.push(stroke(v, [[px, a], [px, a - m(0.9)]], { seed: seed + 30 + px, weight: 3, colour: "#a8a8ae" }));
    drawn.push(stroke(v, [[x + wide + 4, b], [x + wide + 4, b - m(0.9)]], { seed: seed + 40, weight: 3, colour: "#a8a8ae" }));
    if (e.label !== undefined) drawn.push(sign(v, x + wide / 2, a - m(1.15), `v ${e.label}`, seed + 50));
  }
  return drawn;
}

function ladder(v: View, r: RoomSpec, e: Exit, seed: number): Drawing {
  const out: Drawing[] = [];
  const x = m(e.x ?? 1), top = BACK_FOOT_Y - m(ceilingOf(r));
  for (const dx of [-16, 16]) out.push(stroke(v, [[x + dx, BACK_FOOT_Y + 4], [x + dx, top - 30]], { seed: seed + dx, weight: 3.5, colour: "#8a8a90" }));
  for (let y = BACK_FOOT_Y - 20; y > top - 20; y -= 34) out.push(stroke(v, [[x - 16, y], [x + 16, y]], { seed: seed + y, weight: 2.6, colour: "#8a8a90", amp: 0.3 }));
  out.push(blob(v, ellipsePts(x, top - 34, 34, 10), { fill: "#2a2228", seed: seed + 3, line: 2.2 }));
  if (e.label !== undefined) out.push(sign(v, x + 100, top + 60, `^ ${e.label}`, seed + 50));
  return out;
}

/** A pneumatic transit tube: a glass booth that takes you somewhere else. */
function tube(v: View, room: RoomSpec, e: Exit, seed: number): Drawing {
  const x = m(e.x ?? 1), r = m(0.5), h = m(2.4);
  return [
    blob(v, roundRectPts(x - r - 10, BACK_FOOT_Y - 14, r * 2 + 20, 14, 5), { fill: "#9a9ea4", light: "#c8ccd0", seed, line: 2 }),
    blob(v, roundRectPts(x - r - 10, BACK_FOOT_Y - h - 6, r * 2 + 20, 16, 5), { fill: "#9a9ea4", light: "#c8ccd0", seed: seed + 1, line: 2 }),
    blob(v, [[x - r, BACK_FOOT_Y - 14], [x + r, BACK_FOOT_Y - 14], [x + r, BACK_FOOT_Y - h + 10], [x - r, BACK_FOOT_Y - h + 10]], { fill: "rgba(170,220,230,0.25)", seed: seed + 2, line: 2.2 }),
    stroke(v, [[x - r + 10, BACK_FOOT_Y - h + 20], [x - r + 14, BACK_FOOT_Y - 30]], { seed: seed + 3, weight: 3, colour: "rgba(255,255,255,0.5)" }),
    stroke(v, [[x, BACK_FOOT_Y - h - 6], [x, BACK_FOOT_Y - m(ceilingOf(room))]], { seed: seed + 4, weight: m(0.3), colour: "#6a6e72" }),
    sign(v, x, BACK_FOOT_Y - h - 40, e.label ?? "Transit", seed + 10),
    v.text("KEEP LIMBS INSIDE", { x, y: BACK_FOOT_Y - m(1.4) }, { size: 8, fill: "#e8e0d0", align: "center", valign: "middle" }),
  ];
}

export function paintExitsBack(v: View, r: RoomSpec): Drawing {
  const out: Drawing[] = [];
  for (const [i, e] of r.exits.entries()) {
    const seed = 300 + i * 60;
    switch (e.kind) {
      case "door": out.push(backDoor(v, e, seed)); break;
      case "stairs-up": out.push(stairs(v, r, e, seed)); break;
      case "ladder": out.push(ladder(v, r, e, seed)); break;
      case "tube": out.push(tube(v, r, e, seed)); break;
      case "edge-left":
      case "edge-right":
      case "stairs-down":
        break;
    }
  }
  return out;
}
function paintExitsFloor(v: View, r: RoomSpec): Drawing {
  const out: Drawing[] = [];
  for (const [i, e] of r.exits.entries()) {
    const seed = 300 + i * 60;
    if (e.kind === "stairs-down") out.push(stairs(v, r, e, seed));
    if (e.kind === "edge-left" || e.kind === "edge-right") out.push(edgeExit(v, r, e, seed));
  }
  return out;
}

/** The still room: rock, wall, wall pieces, back exits, ceiling, floor, floor exits,
 * furniture, ends. */
export function paintShell(v: View, r: RoomSpec): Drawing {
  // Port: `v.paperTexture(0.35)` after the shell becomes the shell drawn in a
  // group with `effects.paper` (draft section 2).
  return v.group({ effects: { paper: 0.35 } }, [
    bedrock(v, r),
    wall(v, r),
    r.paintWall?.(v),
    paintExitsBack(v, r),
    ceiling(v, r),
    floor(v, r),
    paintExitsFloor(v, r),
    r.paintFurniture?.(v),
    ends(v, r),
  ]);
}

// --- Light ---------------------------------------------------------------------------------

export const rgba = (c: readonly number[], a: number): string => `rgba(${Math.round(c[0] ?? 0)},${Math.round(c[1] ?? 0)},${Math.round(c[2] ?? 0)},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
export function hexRgb(h: string): [number, number, number] {
  const n = Number.parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A soft pool of light. */
export function glow(v: View, x: number, y: number, a: { rx: number; ry?: number; colour: string; alpha: number }): Drawing {
  const ry = a.ry ?? a.rx;
  const c = hexRgb(a.colour);
  return v.ellipse(x, y, a.rx, ry, { fill: v.ellipseGradient(x, y, a.rx, ry, [[0, rgba(c, a.alpha)], [1, rgba(c, 0)]]), blend: "screen" });
}

/** The light from exits: each doorway glows with the room beyond. */
export function exitGlows(v: View, r: RoomSpec, t: number): Drawing {
  const out: Drawing[] = [];
  for (const [i, e] of r.exits.entries()) {
    if (e.glow === undefined) continue;
    const flick = 0.9 + 0.1 * Math.sin(t * 0.05 + i);
    switch (e.kind) {
      case "edge-left": out.push(glow(v, 30, BACK_FOOT_Y - m(1.0), { rx: 70, ry: 170, colour: e.glow, alpha: 0.45 * flick })); break;
      case "edge-right": out.push(glow(v, m(r.width) - 30, BACK_FOOT_Y - m(1.0), { rx: 70, ry: 170, colour: e.glow, alpha: 0.45 * flick })); break;
      case "door":
        if (e.style === "closed") {
          // Only the keypad light: red, locked to anyone but the resident.
          const kx = m(e.x ?? 1) + m(0.45) + 24, ky = BACK_FOOT_Y - m(1.3) + 6;
          out.push(v.circle(kx, ky, 2.4, { fill: e.glow }));
          out.push(glow(v, kx, ky, { rx: 10, colour: e.glow, alpha: 0.6 * flick }));
        } else out.push(glow(v, m(e.x ?? 1), BACK_FOOT_Y - m(0.9), { rx: 60, ry: 140, colour: e.glow, alpha: 0.5 * flick }));
        break;
      case "stairs-up": out.push(glow(v, m(e.x ?? 1) + m(1.6), BACK_FOOT_Y - m(1.7), { rx: 60, ry: 130, colour: e.glow, alpha: 0.45 * flick })); break;
      case "stairs-down": out.push(glow(v, m(e.x ?? 1) + m(0.8), footY(0.95), { rx: m(0.9), ry: 26, colour: e.glow, alpha: 0.6 * flick })); break;
      case "ladder": out.push(glow(v, m(e.x ?? 1), BACK_FOOT_Y - m(ceilingOf(r)) - 30, { rx: 50, ry: 30, colour: e.glow, alpha: 0.6 * flick })); break;
      case "tube": out.push(glow(v, m(e.x ?? 1), BACK_FOOT_Y - m(1.2), { rx: 50, ry: 180, colour: e.glow, alpha: 0.3 + 0.2 * Math.max(0, Math.sin(t * 0.08)) })); break;
    }
  }
  return out;
}

/** Dim the room toward its ambient colour. */
export function dim(v: View, r: RoomSpec): Drawing {
  return v.rect(-300, 0, m(r.width) + 600, VIEW_H, { fill: r.ambient ?? "#9aa0b8", blend: "multiply" });
}

export { INK, blob, ellipsePts, hash, ink, rivet, roundRectPts, stroke, wobble };

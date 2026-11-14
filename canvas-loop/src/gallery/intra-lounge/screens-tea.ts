// What every glowing thing in the lounge does, frame by frame: the monitors'
// pictures, the light each throws (one function, so the light always matches the
// picture), the vending machine's hum, the shelves' status lights, and the sky's
// static bursts. Everything repeats every PERIOD frames.
import type { View } from "@ianbicking/canvas-loop";
import { CRTS, CRT_FRONT, type Crt, LIGHTS, SCALE, SHELF, SHELF_FACE, VENDING, faceTransform, hash, hex, project, pxPerM } from "./scene-tea.js";

/** Draws `body` in local px on a face of constant z: x right from world x0, y down from world y1. */
function onFace(v: View, at: { x0: number; y1: number; z: number }, body: () => void): void {
  const [a, b, c, d, e, f] = faceTransform(at.x0, at.y1, at.z);
  v.ctx.save();
  v.ctx.transform(a, b, c, d, e, f);
  body();
  v.ctx.restore();
}

export const PERIOD = 144;
type RGB = [number, number, number];

const SHOW_COLOUR: Record<Crt["show"], string> = {
  text: "#56ff8e", bars: "#ffb446", scope: "#64f4ff", hex: "#d6e6ff", roll: "#4a74ff", static: "#c8c8d0", map: "#7dffc8",
};

/** Two monitors throw an error, at different times. */
function erroring(i: number, t: number): boolean {
  if (i === 5) return t % PERIOD >= 40 && t % PERIOD < 64 && Math.floor(t / 4) % 2 === 0;
  if (i === 10) return t % PERIOD >= 100 && t % PERIOD < 130;
  return false;
}

/** The sky screen overhead bursts into static now and then. */
export function skyBurst(t: number): number {
  const p = t % PERIOD;
  return p >= 84 && p < 92 ? (hash(p, 0, 7) < 0.6 ? 1 : 0.3) : 0;
}

interface ScreenState {
  colour: string;
  /** 0..1.4. */
  level: number;
  error: boolean;
}
export function screenState(i: number, t: number): ScreenState {
  const c = CRTS[i];
  const error = erroring(i, t);
  if (!c) return { colour: "#000000", level: 0, error };
  const a = (2 * Math.PI * (t % PERIOD)) / PERIOD;
  // A slow breathing, a faster shimmer, and a stutter on some frames.
  let level = 0.82 + 0.08 * Math.sin(a * (1 + (i % 3)) + i) + 0.05 * Math.sin(a * 9 + i * 2.3);
  if (hash(i, Math.floor(t / 2), 9) < 0.04) level *= 0.55;
  if (c.show === "static") level = 0.55 + hash(i, t, 11) * 0.35;
  return { colour: error ? "#ff3a30" : SHOW_COLOUR[c.show], level: error ? 1.25 : level, error };
}

/** Each light's colour this frame, scaled by its brightness. */
export function lightColours(t: number): RGB[] {
  const hum = 1 + 0.035 * Math.sin(t * 2.1) + (hash(t, 0, 13) < 0.02 ? -0.25 : 0);
  return LIGHTS.map((_, l): RGB => {
    if (l < CRTS.length) {
      const s = screenState(l, t);
      const [r, g, b] = hex(s.colour);
      return [r * s.level * 2.3, g * s.level * 2.3, b * s.level * 2.3];
    }
    if (l === CRTS.length) return [1.3 * hum, 1.5 * hum, 1.7 * hum];
    if (l === CRTS.length + 1) return [1.1, 0.75, 1.1];
    return [1.2, 0.55, 0.8];
  });
}

export function skyColour(t: number): RGB {
  const b = skyBurst(t);
  return [0.06 + b * 0.3, 0.08 + b * 0.34, 0.17 + b * 0.45];
}

// --- Pictures on the screens ---------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Unreadable data: little blocky glyphs on a grid. */
function glyphs(v: View, r: Rect, a: { colour: string; rows: number; seed: number; t: number; scroll: boolean }): void {
  const lh = r.h / a.rows, gw = lh * 0.55;
  const shift = a.scroll ? Math.floor(a.t / 3) : 0;
  for (let row = 0; row < a.rows; row++) {
    const len = Math.floor(hash(a.seed, row + shift, 1) * (r.w / gw));
    for (let c = 0; c < len; c++) {
      if (hash(a.seed * 31 + c, row + shift, 2) < 0.25) continue;
      const bits = Math.floor(hash(a.seed + c, row + shift, 3) * 4);
      v.rect(r.x + 2 + c * gw, r.y + 2 + row * lh, gw * (bits % 2 === 0 ? 0.7 : 0.45), lh * 0.6, { fill: a.colour });
    }
  }
  // The cursor, blinking at the end of the last line.
  if (Math.floor(a.t / 10) % 2 === 0) v.rect(r.x + 2, r.y + r.h - lh, gw * 0.7, lh * 0.65, { fill: a.colour });
}

function picture(v: View, r: Rect, a: { crt: Crt; i: number; t: number; state: ScreenState }): void {
  const { crt, i, t, state } = a;
  const col = state.colour;
  if (state.error) {
    v.rect(r.x, r.y, r.w, r.h, { fill: "#6a0a0a" });
    v.rect(r.x + r.w * 0.12, r.y + r.h * 0.3, r.w * 0.76, r.h * 0.4, { fill: "#ff3a30" });
    v.text("ERROR", { x: r.x + r.w / 2, y: r.y + r.h / 2 }, { size: Math.max(5, r.h * 0.18), fill: "#2a0000", align: "center", valign: "middle", style: "bold" });
    return;
  }
  const [cr, cg, cb] = hex(col);
  v.rect(r.x, r.y, r.w, r.h, { fill: `rgb(${Math.round(cr * 30)},${Math.round(cg * 34)},${Math.round(cb * 34)})` });
  switch (crt.show) {
    case "text": glyphs(v, r, { colour: col, rows: 9, seed: i, t, scroll: true }); break;
    case "hex": glyphs(v, r, { colour: col, rows: 7, seed: i * 7, t: t * 0.2, scroll: false }); break;
    case "bars": {
      for (let b = 0; b < 9; b++) {
        const hgt = (0.2 + 0.7 * Math.abs(Math.sin(t * 0.07 * (1 + (b % 3)) + b * 1.7 + i))) * r.h * 0.8;
        v.rect(r.x + 3 + b * ((r.w - 6) / 9), r.y + r.h - 3 - hgt, ((r.w - 6) / 9) * 0.7, hgt, { fill: col });
      }
      break;
    }
    case "scope": {
      const pts: [number, number][] = [];
      for (let k = 0; k <= 40; k++) {
        const u = k / 40;
        const yv = Math.sin(u * 14 + t * 0.25 + i) * 0.28 + Math.sin(u * 37 - t * 0.6) * 0.08;
        pts.push([r.x + u * r.w, r.y + r.h * (0.5 + yv)]);
      }
      v.polygon([...pts, [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]], { fill: "rgba(100,244,255,0.08)" });
      for (let k = 0; k + 1 < pts.length; k++) {
        const p0 = pts[k] ?? [0, 0], p1 = pts[k + 1] ?? [0, 0];
        v.line(p0[0], p0[1], p1[0], p1[1], { stroke: col, weight: 1.4 });
      }
      v.line(r.x, r.y + r.h / 2, r.x + r.w, r.y + r.h / 2, { stroke: "rgba(100,244,255,0.25)", weight: 0.6 });
      break;
    }
    case "roll": {
      v.rect(r.x, r.y, r.w, r.h, { fill: "#1a2a9a" });
      glyphs(v, r, { colour: "#dfe6ff", rows: 6, seed: i * 3, t: 0, scroll: false });
      // The picture rolls: a bright bar sliding down, the frame torn across it.
      const band = ((t * 1.6) % (r.h + 16)) - 8;
      v.rect(r.x, r.y + band, r.w, 6, { fill: "rgba(200,215,255,0.5)" });
      break;
    }
    case "static": {
      const cell = Math.max(2, r.w / 26);
      for (let yy = 0; yy < r.h; yy += cell) {
        for (let xx = 0; xx < r.w; xx += cell) {
          const g = Math.floor(hash(Math.floor(xx), Math.floor(yy) + t * 101, 17) * 200);
          v.rect(r.x + xx, r.y + yy, cell, cell, { fill: `rgb(${g},${g},${g + 10})` });
        }
      }
      break;
    }
    case "map": {
      // A sweep round a grid, leaving blips behind.
      for (let g = 1; g < 4; g++) v.line(r.x + (r.w * g) / 4, r.y, r.x + (r.w * g) / 4, r.y + r.h, { stroke: "rgba(125,255,200,0.2)", weight: 0.6 });
      for (let g = 1; g < 3; g++) v.line(r.x, r.y + (r.h * g) / 3, r.x + r.w, r.y + (r.h * g) / 3, { stroke: "rgba(125,255,200,0.2)", weight: 0.6 });
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2, ang = t * 0.09;
      v.line(cx, cy, cx + Math.cos(ang) * r.w * 0.6, cy + Math.sin(ang) * r.h * 0.6, { stroke: col, weight: 1.2 });
      for (let b = 0; b < 5; b++) {
        const ba = hash(i, b, 19) * Math.PI * 2;
        const age = (((ang - ba) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const alpha = Math.max(0, 1 - age / 3);
        v.circle(cx + Math.cos(ba) * r.w * 0.3 * hash(i, b, 23), cy + Math.sin(ba) * r.h * 0.35 * hash(i, b, 29), 1.5, { fill: `rgba(125,255,200,${alpha.toFixed(3)})` });
      }
      break;
    }
  }
}

/** The screens: picture, scanlines, the tube's dark corners, glass glare, and bloom. */
export function paintScreens(v: View, t: number): void {
  for (const [i, crt] of CRTS.entries()) {
    const r = { x: 0, y: 0, w: crt.w * 0.8 * SCALE, h: crt.h * 0.78 * SCALE };
    const state = screenState(i, t);
    onFace(v, { x0: crt.x - (crt.w / 2) * 0.8, y1: crt.y + (crt.h / 2) * 0.84, z: CRT_FRONT - 0.002 }, () => {
      const shape = (): void => v.roundRect(r.x, r.y, r.w, r.h, r.w * 0.12, { fill: "#000" });
      v.mask(shape, () => {
        picture(v, r, { crt, i, t, state });
        for (let yy = r.y; yy < r.y + r.h; yy += 2) v.line(r.x, yy, r.x + r.w, yy, { stroke: "rgba(0,0,0,0.28)", weight: 0.8 });
        v.rect(r.x, r.y, r.w, r.h, { fill: v.ellipseGradient(r.x + r.w / 2, r.y + r.h / 2, r.w * 0.62, r.h * 0.62, [[0.55, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,0.7)"]]) });
        v.rect(r.x, r.y, r.w, r.h, { fill: v.linearGradient(r.x, r.y, r.x + r.w * 0.6, r.y + r.h * 0.6, [[0, "rgba(255,255,255,0.14)"], [0.5, "rgba(255,255,255,0)"]]) });
        v.rect(r.x, r.y, r.w, r.h, { fill: `rgba(0,0,0,${(0.9 - Math.min(0.9, state.level * 0.8)).toFixed(3)})` });
      });
      const [cr, cg, cb] = hex(state.colour);
      const glow = `rgba(${Math.round(cr * 255)},${Math.round(cg * 255)},${Math.round(cb * 255)},`;
      const gx = r.x + r.w / 2, gy = r.y + r.h / 2;
      v.ellipse(gx, gy, r.w * 0.95, r.h * 0.95, { fill: v.ellipseGradient(gx, gy, r.w * 0.95, r.h * 0.95, [[0, `${glow}${(0.22 * state.level).toFixed(3)})`], [1, `${glow}0)`]]), blend: "screen" });
    });
  }
}

/** The vending machine's lit front, its rows of unlabeled drinks, and its hum. */
export function paintVending(v: View, t: number): void {
  const x0 = VENDING.x0 + 0.06, x1 = VENDING.x1 - 0.2, y0 = 0.75, y1 = 1.8;
  const w = (x1 - x0) * SCALE, h = (y1 - y0) * SCALE;
  const hum = 0.92 + 0.05 * Math.sin(t * 2.1) + (hash(t, 0, 13) < 0.02 ? -0.3 : 0);
  onFace(v, { x0, y1, z: VENDING.z0 - 0.002 }, () => {
    v.rect(0, 0, w, h, { fill: `rgba(215,235,255,${hum.toFixed(3)})` });
    const drinks = ["#e85a5a", "#5ad1e8", "#e8d35a", "#a05ae8", "#5ae87a", "#e8925a"];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 3; col++) {
        const cx = (col + 0.5) * (w / 3), cy = (row + 0.55) * (h / 4);
        v.roundRect(cx - w * 0.09, cy - h * 0.07, w * 0.18, h * 0.12, 2, { fill: drinks[(row * 3 + col) % drinks.length] ?? "#fff" });
        v.rect(4, cy + h * 0.06, w - 8, 2, { fill: "rgba(60,70,90,0.6)" });
      }
    }
    v.ellipse(w / 2, h / 2, w * 1.3, h * 0.9, { fill: v.ellipseGradient(w / 2, h / 2, w * 1.3, h * 0.9, [[0, `rgba(190,220,255,${(0.25 * hum).toFixed(3)})`], [1, "rgba(190,220,255,0)"]]), blend: "screen" });
  });
}

/** Status lights on the archive shelves, blinking on their own patterns. */
export function paintLeds(v: View, t: number): void {
  const colours = ["#4dff7a", "#ffb03a", "#ff4a3a", "#4dff7a", "#4dff7a"];
  for (let i = 0; i < 60; i++) {
    const row = Math.floor(hash(i, 0, 71) * 6);
    const y = row * 0.4 + 0.3, z = SHELF.z0 + 0.1 + hash(i, 0, 73) * (SHELF.z1 - SHELF.z0 - 0.2);
    if (y > SHELF.y1 - 0.05) continue;
    const rate = 3 + Math.floor(hash(i, 0, 79) * 20);
    const on = hash(i, Math.floor(t / rate), 83) < 0.6;
    if (!on) continue;
    const [px, py] = project(SHELF_FACE + 0.005, y, z);
    const s = pxPerM(z);
    const c = colours[i % colours.length] ?? "#4dff7a";
    v.circle(px, py, s * 0.025, { fill: v.radialGradient(px, py, s * 0.025, [[0, `${c}aa`], [1, `${c}00`]]), blend: "screen" });
    v.circle(px, py, Math.max(0.9, s * 0.007), { fill: c });
  }
}

/** Dust hanging in the screens' light. */
export function paintMotes(v: View, t: number): void {
  for (let i = 0; i < 50; i++) {
    const x = -2.6 + hash(i, 0, 91) * 3.4 + Math.sin(t * 0.02 + i) * 0.05;
    const y = 0.3 + ((hash(i, 0, 93) * 2.4 + t * 0.0015) % 2.4);
    const z = 3.2 + hash(i, 0, 97) * 1.2;
    const [px, py] = project(x, y, z);
    const a = 0.25 + 0.35 * Math.max(0, Math.sin(t * 0.05 + i * 1.3));
    v.circle(px, py, 0.9, { fill: `rgba(220,240,255,${a.toFixed(3)})` });
  }
}

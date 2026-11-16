// What moves in the drawn lounge, each frame: the room dims, every set glows with
// what it shows (and the glow spills onto what is in front of it), the vending
// machine's window hums, the archive machine's lights blink. Repeats every PERIOD.
import type { Drawing, View } from "@ianbicking/canvas-loop";
import { hash, iso } from "./ink-tea.js";
import { RU, RW, TELLIES, type Telly, VENDING_AT, WALL, leaning, screenRect } from "./room-tea.js";

export const PERIOD = 144;

const SHOW_COLOUR: Record<Telly["show"], [number, number, number]> = {
  text: [86, 255, 142], bars: [255, 180, 70], scope: [100, 244, 255], hex: [214, 230, 255], roll: [74, 116, 255], static: [200, 200, 208], map: [125, 255, 200],
};

function state(i: number, t: number): { rgb: [number, number, number]; level: number; error: boolean } {
  const tl = TELLIES[i];
  const p = t % PERIOD;
  const error = (i === 4 && p >= 40 && p < 64 && Math.floor(t / 4) % 2 === 0) || (i === 7 && p >= 100 && p < 128);
  if (!tl) return { rgb: [0, 0, 0], level: 0, error };
  const a = (2 * Math.PI * p) / PERIOD;
  let level = 0.8 + 0.1 * Math.sin(a * (1 + (i % 3)) + i) + 0.06 * Math.sin(a * 9 + i * 2.3);
  if (hash(i, Math.floor(t / 2), 9) < 0.05) level *= 0.5;
  if (tl.show === "static") level = 0.55 + hash(i, t, 11) * 0.35;
  return { rgb: error ? [255, 58, 48] : SHOW_COLOUR[tl.show], level: error ? 1.2 : level, error };
}

const rgba = (c: readonly number[], a: number): string => `rgba(${Math.round(c[0] ?? 0)},${Math.round(c[1] ?? 0)},${Math.round(c[2] ?? 0)},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Draws in a set's screen's own px: x right along the wall, y down. */
function onScreen(v: View, tl: Telly, body: (w: number, h: number) => Drawing): Drawing {
  const s = screenRect(tl);
  const [e, f] = iso(s.u0, tl.depth + 1, s.h1);
  return leaning(v, tl, () => {
    // Port (scene core chunk 5): `v.ctx.transform` became `at({ matrix })`.
    return v.at({ matrix: [0.894, 0.447, 0, 1, e, f] }, body(s.w, s.h));
  });
}

/** Unreadable data: blocky glyphs. */
function glyphs(v: View, a: { w: number; h: number; colour: string; rows: number; seed: number; shift: number }): Drawing {
  const out: Drawing[] = [];
  const lh = a.h / a.rows, gw = lh * 0.6;
  for (let row = 0; row < a.rows; row++) {
    const len = Math.floor(hash(a.seed, row + a.shift, 1) * (a.w / gw - 1));
    for (let c = 0; c < len; c++) {
      if (hash(a.seed * 31 + c, row + a.shift, 2) < 0.25) continue;
      out.push(v.rect(3 + c * gw, 3 + row * lh, gw * 0.65, lh * 0.55, { fill: a.colour }));
    }
  }
  return out;
}

function picture(v: View, tl: Telly, i: number, t: number, w: number, h: number): Drawing {
  const out: Drawing[] = [];
  const st = state(i, t);
  const col = rgba(st.rgb, 1);
  if (st.error) {
    out.push(v.rect(0, 0, w, h, { fill: "#5a0a0a" }));
    out.push(v.roundRect(w * 0.12, h * 0.3, w * 0.76, h * 0.4, 3, { fill: col }));
    out.push(v.text("ERROR", { x: w / 2, y: h / 2 }, { size: Math.max(6, h * 0.2), fill: "#2a0000", align: "center", valign: "middle", style: "bold" }));
    return out;
  }
  out.push(v.rect(0, 0, w, h, { fill: rgba(st.rgb.map((c) => c * 0.12), 1) }));
  switch (tl.show) {
    case "text": out.push(glyphs(v, { w, h, colour: col, rows: 8, seed: i, shift: Math.floor(t / 3) })); break;
    case "hex": out.push(glyphs(v, { w, h, colour: col, rows: 6, seed: i * 7, shift: Math.floor(t / 40) })); break;
    case "bars":
      for (let b = 0; b < 7; b++) {
        const bh = (0.2 + 0.7 * Math.abs(Math.sin(t * 0.07 * (1 + (b % 3)) + b * 1.7))) * h * 0.8;
        out.push(v.rect(4 + b * ((w - 8) / 7), h - 4 - bh, ((w - 8) / 7) * 0.7, bh, { fill: col }));
      }
      break;
    case "scope": {
      const pts: [number, number][] = [];
      for (let k = 0; k <= 30; k++) pts.push([(k / 30) * w, h * (0.5 + Math.sin((k / 30) * 13 + t * 0.25) * 0.3)]);
      out.push(v.curve(pts, false, { stroke: col, weight: 1.6 }));
      break;
    }
    case "roll": {
      out.push(v.rect(0, 0, w, h, { fill: "#1a2a9a" }));
      out.push(glyphs(v, { w, h, colour: "#dfe6ff", rows: 5, seed: i * 3, shift: 0 }));
      out.push(v.rect(0, ((t * 1.4) % (h + 14)) - 7, w, 5, { fill: "rgba(200,215,255,0.55)" }));
      break;
    }
    case "static": {
      const cell = Math.max(2.5, w / 18);
      for (let y = 0; y < h; y += cell) for (let x = 0; x < w; x += cell) {
        const g = Math.floor(hash(Math.floor(x), Math.floor(y) + t * 101, 17) * 200);
        out.push(v.rect(x, y, cell, cell, { fill: `rgb(${g},${g},${g + 10})` }));
      }
      break;
    }
    case "map": {
      const ang = t * 0.09;
      out.push(v.line(w / 2, h / 2, w / 2 + Math.cos(ang) * w * 0.55, h / 2 + Math.sin(ang) * h * 0.55, { stroke: col, weight: 1.3 }));
      for (let b = 0; b < 4; b++) out.push(v.circle(w * (0.2 + hash(i, b, 3) * 0.6), h * (0.2 + hash(i, b, 4) * 0.6), 1.6, { fill: col }));
      break;
    }
  }
  // Scanlines, and the dim of a tired tube.
  for (let y = 0; y < h; y += 2.5) out.push(v.line(0, y, w, y, { stroke: "rgba(0,0,0,0.25)", weight: 0.8 }));
  out.push(v.rect(0, 0, w, h, { fill: `rgba(0,0,0,${(0.9 - Math.min(0.9, st.level * 0.8)).toFixed(3)})` }));
  return out;
}

export function paintLight(v: View, t: number): Drawing {
  const out: Drawing[] = [];
  // The room dims; only what glows lights it.
  out.push(v.rect(0, 0, 1200, 860, { fill: "#8a92b4", blend: "multiply" }));
  // Each set's glow, spilling forward onto the floor, the table and the sofa.
  for (const [i, tl] of TELLIES.entries()) {
    const st = state(i, t);
    const s = screenRect(tl);
    const [gx, gy] = iso(s.u0 + s.w / 2, tl.depth + 60, s.h1 - s.h / 2 - 30);
    const r = 150 + tl.width;
    out.push(v.ellipse(gx, gy, r, r * 0.7, { fill: v.ellipseGradient(gx, gy, r, r * 0.7, [[0, rgba(st.rgb, 0.28 * st.level)], [1, rgba(st.rgb, 0)]]), blend: "screen" }));
  }
  // The pictures, each on its own slanted screen, with a halo.
  for (const [i, tl] of TELLIES.entries()) {
    const st = state(i, t);
    out.push(onScreen(v, tl, (w, h) => {
      return [
        v.mask(v.roundRect(0, 0, w, h, Math.min(w, h) * 0.22, { fill: "#000" }), picture(v, tl, i, t, w, h)),
        v.ellipse(w / 2, h / 2, w * 0.9, h * 0.9, { fill: v.ellipseGradient(w / 2, h / 2, w * 0.9, h * 0.9, [[0, rgba(st.rgb, 0.25 * st.level)], [1, rgba(st.rgb, 0)]]), blend: "screen" }),
      ];
    }));
  }
  // The vending machine's window: cold light and rows of unlabeled drinks.
  const [cx, cy] = iso(VENDING_AT.u, VENDING_AT.w, 0);
  const hum = 0.9 + 0.06 * Math.sin(t * 2.1) + (hash(t, 0, 13) < 0.02 ? -0.3 : 0);
  out.push(v.mask(v.roundRect(cx - 24, cy - 146, 38, 76, 13, { fill: "#000" }), ((): Drawing => {
    const drawn: Drawing[] = [];
    drawn.push(v.rect(cx - 30, cy - 150, 50, 84, { fill: rgba([205, 230, 255], hum) }));
    const drinks = ["#e85a5a", "#5ad1e8", "#e8d35a", "#a05ae8", "#5ae87a"];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
      drawn.push(v.roundRect(cx - 19 + c * 16, cy - 138 + r * 17, 10, 12, 3, { fill: drinks[(r * 2 + c) % drinks.length] ?? "#fff" }));
    }
    return drawn;
  })()));
  out.push(v.ellipse(cx - 5, cy - 108, 110, 90, { fill: v.ellipseGradient(cx - 5, cy - 108, 110, 90, [[0, rgba([190, 220, 255], 0.22 * hum)], [1, rgba([190, 220, 255], 0)]]), blend: "screen" }));
  // The archive machine's status lights.
  for (let i = 0; i < 9; i++) {
    const on = hash(i, Math.floor(t / (4 + i * 3)), 83) < 0.6;
    if (!on) continue;
    const [lx, ly] = iso(49, 216 + i * 11, 12);
    const c = i % 4 === 3 ? [255, 80, 60] : i % 3 === 0 ? [255, 176, 58] : [77, 255, 122];
    out.push(v.circle(lx, ly, 6, { fill: v.radialGradient(lx, ly, 6, [[0, rgba(c, 0.7)], [1, rgba(c, 0)]]), blend: "screen" }));
    out.push(v.circle(lx, ly, 1.6, { fill: rgba(c, 1) }));
  }
  // The sky screen overhead shows only as a strip of pixelated blue along the wall
  // tops, bursting into static now and then.
  const burst = t % PERIOD >= 84 && t % PERIOD < 92;
  for (const side of ["right", "left"] as const) {
    const len = side === "right" ? RU : RW;
    for (let a = 6; a < len - 6; a += 9) {
      const bow = Math.sin((a / len) * Math.PI) * (side === "right" ? 6 : -4);
      const [x, y] = side === "right" ? iso(a, 0, WALL + bow - 2) : iso(0, a, WALL + bow - 2 - (a / len) * 26);
      const n = hash(Math.floor(a / 9), Math.floor(t / (burst ? 1 : 12)), side === "right" ? 1 : 2);
      const c = burst ? (n < 0.5 ? [230, 235, 255] : [40, 44, 60]) : n < 0.15 ? [200, 220, 255] : n < 0.6 ? [70, 120, 230] : [40, 80, 190];
      out.push(v.rect(x - 4, y - 9, 8, 7, { fill: rgba(c, 0.9) }));
    }
  }
  if (burst) out.push(v.rect(0, 0, 1200, 860, { fill: "rgba(150,170,255,0.06)", blend: "screen" }));
  // The Console beyond its arch, pink and teal.
  const [dx, dy] = iso(432, 0, 60);
  out.push(v.ellipse(dx, dy, 34, 70, { fill: v.ellipseGradient(dx, dy, 34, 70, [[0, "rgba(255,95,174,0.55)"], [0.6, "rgba(62,230,208,0.25)"], [1, "rgba(62,230,208,0)"]]), blend: "screen" }));
  return out;
}

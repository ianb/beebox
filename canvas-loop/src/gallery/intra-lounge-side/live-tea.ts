// What glows and moves in the side-view lounge, frame by frame: the room dims; the
// sky screen overhead shows its pixelated blue, bursting into static and error
// messages; the sets show unreadable data and throw their light; the archive reels
// turn; the vending window hums; the doorways glow with the rooms beyond; the bulb
// stutters; someone walks through. Most of it repeats every PERIOD frames.
import type { Vec2, View } from "@ianbicking/canvas-loop";
import { blob, ellipsePts, hash, ink } from "./ink-tea.js";
import { DEAD_PANEL, FLOOR, H, PANELS, PLACES, TELLIES, type Telly, VENDING, W, leaning, onScreen, placed, screenOf, sitter } from "./scene-tea.js";
import { PLANES, SIZES, footY, m } from "./sizes-tea.js";

export const PERIOD = 144;
type RGB = readonly [number, number, number];
const rgba = (c: RGB, a: number): string => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

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

/** The sky screen: pixelated blue with clouds, bursts of static, and error boxes. */
function sky(v: View, t: number): void {
  const p = t % PERIOD;
  const burst = p >= 84 && p < 92;
  for (const [i, [a, b]] of PANELS.entries()) {
    const y0 = 52, y1 = 116;
    v.mask(() => v.rect(a + 2, y0 + 2, b - a - 4, y1 - y0, { fill: "#000" }), () => {
      if (i === DEAD_PANEL) {
        // Dead, but now and then a pixel or two sputters.
        if (hash(Math.floor(t / 3), 0, 31) < 0.3) v.rect(a + 40 + hash(t, 1, 32) * (b - a - 80), y0 + 10 + hash(t, 2, 33) * 40, 8, 8, { fill: "#4a78e0" });
        return;
      }
      const cell = 8;
      for (let y = y0; y < y1; y += cell) {
        for (let x = a; x < b; x += cell) {
          const gx = Math.floor((x - a) / cell), gy = Math.floor((y - y0) / cell);
          let c: RGB = gy < 3 ? [58, 104, 220] : [86, 142, 240];
          // Blocky clouds drifting slowly.
          const drift = Math.floor(t / 10);
          if (hash(Math.floor((gx + drift + i * 13) / 3), Math.floor(gy / 2), 41) < 0.22) c = [228, 236, 250];
          if (burst) {
            const n = hash(gx, gy + t * 7, 43);
            c = n < 0.45 ? [230, 232, 240] : n < 0.8 ? [40, 44, 60] : [120, 130, 160];
          }
          v.rect(x, y, cell, cell, { fill: rgba(c, 1) });
        }
      }
      // An error box on one panel, flashing before the sky resets.
      if (i === 1 && p >= 92 && p < 116 && Math.floor(t / 4) % 2 === 0) {
        const bx = a + 90, by = y0 + 12;
        v.rect(bx, by, 120, 38, { fill: "#d8d8e0" });
        v.rect(bx, by, 120, 9, { fill: "#2a2ad0" });
        v.text("ERR 0x0F  SKY", { x: bx + 60, y: by + 25 }, { size: 9, fill: "#a01010", align: "center", valign: "middle", style: "bold" });
      }
    });
  }
  // The screens' blue falls down the wall.
  v.rect(0, 50, W, 220, { fill: v.linearGradient(0, 50, 0, 270, [[0, burst ? "rgba(200,210,255,0.22)" : "rgba(90,140,255,0.16)"], [1, "rgba(90,140,255,0)"]]), blend: "screen" });
}

/** Someone walking along the front of the room, from the Atrium to the Pool and back. */
function walker(v: View, t: number): void {
  const span = 1040, speed = 1.3;
  const d = (t * speed) % (span * 2);
  const right = d < span;
  const x = 110 + (right ? d : span * 2 - d);
  const y = footY(PLANES.walk);
  /** The walker is drawn 140 px tall; scaled to a real person. */
  const k = m(SIZES.woman.h) / 140;
  const step = Math.sin(t * 0.3);
  // Light near the sets and the vending window; dimmer at the ends.
  const lit = Math.max(0, 1 - Math.abs(x - 720) / 600);
  v.at({ translate: [x, y], scale: [right ? k : -k, k] }, () => {
    v.ellipse(0, 0, 26, 6, { fill: "rgba(0,0,0,0.45)" });
    for (const s of [-1, 1]) {
      const swing = s * step * 10;
      blob(v, [[-4 + swing * 0.3, -60], [5 + swing * 0.3, -60], [6 + swing, -2], [-3 + swing, -2]], { fill: "#22252e", seed: 900 + s, line: 1.8, amp: 0.4 });
      blob(v, ellipsePts(swing + 5, -2, 9, 4.5, 10), { fill: "#1a1410", seed: 902 + s, line: 1.4, amp: 0.3 });
    }
    // A long coat, a scarf, a head looking ahead.
    blob(v, [[-16, -54], [16, -54], [12, -112], [0, -118], [-12, -112]], { fill: "#5a3440", light: "#7a4a56", dark: "#3a1e28", seed: 905, shadeSide: "left", line: 2.2 });
    blob(v, [[-11, -112], [12, -112], [10, -102], [-10, -102]], { fill: "#c8a040", seed: 906, line: 1.6 });
    blob(v, ellipsePts(2, -128, 11, 13, 14), { fill: "#c58a62", light: "#e0a880", seed: 907, line: 2 });
    blob(v, [[-11, -130], [10, -138], [12, -128], [0, -140], [-10, -138]], { fill: "#2e1d15", seed: 908, line: 1.6 });
    v.circle(9, -128, 1.4, { fill: "#1a1010" });
    blob(v, [[10, -100], [16, -96], [20 + step * 4, -64], [14 + step * 4, -62], [8, -92]], { fill: "#4a2a34", seed: 909, line: 1.8 });
  });
  // The screens' green-blue catches the side of them facing the sets.
  v.ellipse(x, y - 70 * k, 30 * k, 70 * k, { fill: v.ellipseGradient(x, y - 70 * k, 30 * k, 70 * k, [[0, rgba([120, 230, 210], 0.18 * lit)], [1, rgba([120, 230, 210], 0)]]), blend: "screen" });
}

export function paintLive(v: View, t: number): void {
  // The room dims; only what glows lights it.
  v.rect(0, 0, W, H, { fill: "#8a90b0", blend: "multiply" });
  sky(v, t);
  // Each set's light, spilling over the cabinet, the sofa and the floor.
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
  v.place(v.picture({ key: "sitter", width: v.width, height: v.height }, () => placed(v, PLACES.sofa, () => sitter(v))), 0, 0);
  // The archive reels, turning in fits.
  placed(v, PLACES.shelves, () => v.at({ translate: [280, FLOOR], rotate: -0.025 }, () => v.at({ translate: [-280, -FLOOR] }, () => {
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
  })));
  // The vending window: cold light and blank coloured cans.
  placed(v, PLACES.vending, () => {
    const hum = 0.9 + 0.06 * Math.sin(t * 2.1) + (hash(t, 0, 13) < 0.02 ? -0.3 : 0);
    const vx = VENDING.x;
    v.mask(() => v.roundRect(vx - 30, 388, 44, 96, 15, { fill: "#000" }), () => {
      v.rect(vx - 34, 384, 52, 104, { fill: rgba([205, 230, 255], hum) });
      const drinks = ["#e85a5a", "#5ad1e8", "#e8d35a", "#a05ae8", "#5ae87a"];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 2; c++) v.roundRect(vx - 22 + c * 18, 396 + r * 18, 12, 13, 3, { fill: drinks[(r * 2 + c) % drinks.length] ?? "#fff" });
    });
    v.ellipse(vx - 8, 436, 130, 110, { fill: v.ellipseGradient(vx - 8, 436, 130, 110, [[0, rgba([190, 220, 255], 0.2 * hum)], [1, rgba([190, 220, 255], 0)]]), blend: "screen" });
  });
  // The doorways: the Atrium's frozen sunset on the left, the Pool's pink on the right.
  placed(v, PLACES.arch, () => v.ellipse(102, 470, 60, 120, { fill: v.ellipseGradient(102, 470, 60, 120, [[0, "rgba(255,140,50,0.55)"], [1, "rgba(255,140,50,0)"]]), blend: "screen" }));
  placed(v, PLACES.poolDoor, () => v.ellipse(1186, 450, 50, 120, { fill: v.ellipseGradient(1186, 450, 50, 120, [[0, "rgba(255,100,170,0.45)"], [1, "rgba(255,100,170,0)"]]), blend: "screen" }));
  // The bulb, mostly dead, sometimes catching.
  if (hash(Math.floor(t / 2), 0, 61) < 0.18) {
    v.circle(478, 232, 46, { fill: v.radialGradient(478, 232, 46, [[0, "rgba(255,220,150,0.6)"], [1, "rgba(255,220,150,0)"]]), blend: "screen" });
  }
  walker(v, t);
}

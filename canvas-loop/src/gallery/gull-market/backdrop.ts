// Sky, sun, sea, the far headland with its houses and lighthouse, boats, and
// the stone quay the market stands on.
import type { Sketch, Vec2 } from "@ianbicking/canvas-loop";
import { form, hash, INK, mark, ring } from "./kit.js";

export const W = 900;
export const H = 700;
export const HORIZON = 232;
export const QUAY = 338;
export const SUN: Vec2 = [800, 78];

export function sky(s: Sketch): void {
  s.background(s.linearGradient(0, 0, 0, HORIZON, [[0, "#5fb4e6"], [0.7, "#a8dcf2"], [1, "#e4f4f6"]]));
  // loose bristle strokes, slightly rising, so the sky reads painted
  for (let i = 0; i < 22; i += 1) {
    const y = 4 + i * 10.5;
    const x0 = -60 + hash(i) * 260;
    const len = 260 + hash(i + 9) * 300;
    const tone = hash(i + 31) > 0.5 ? (i < 11 ? "#3f98d4" : "#8fd0ee") : (i < 11 ? "#79c0ea" : "#d6f1f7");
    mark(s, [[x0, y + 6], [x0 + len * 0.5, y], [x0 + len, y - 4]], {
      color: tone, weight: 26, brush: "bristle", opacity: 0.55, wobble: 2.5, seed: 40 + i,
    });
    mark(s, [[x0 + len + 40, y + 2], [x0 + len + 300, y - 3], [x0 + len + 560, y]], {
      color: tone, weight: 24, brush: "bristle", opacity: 0.5, wobble: 2.5, seed: 140 + i,
    });
  }
  // sun and its glow
  s.noStroke();
  s.fill(s.radialGradient(SUN[0], SUN[1], 150, [[0, "rgba(255,250,214,0.95)"], [0.35, "rgba(255,244,200,0.45)"], [1, "rgba(255,244,200,0)"]]));
  s.circle(SUN[0], SUN[1], 300);
  s.fill("#fff6c8");
  s.circle(SUN[0], SUN[1], 64);
  for (let k = 0; k < 12; k += 1) {
    const a = (k / 12) * Math.PI * 2 + 0.13;
    mark(s, [[SUN[0] + Math.cos(a) * 44, SUN[1] + Math.sin(a) * 44], [SUN[0] + Math.cos(a) * 66, SUN[1] + Math.sin(a) * 66]], {
      color: "#ffd96a", weight: 4, wobble: 0.5, seed: 70 + k,
    });
  }
  cloud(s, [150, 76], 1);
  cloud(s, [470, 46], 0.75);
  cloud(s, [640, 150], 0.55);
  // far-off gulls, a tick each
  for (const [i, [x, y, k]] of ([[560, 118, 1], [596, 98, 0.8], [372, 150, 0.7], [700, 190, 0.6]] as const).entries()) {
    mark(s, [[x - 12 * k, y - 2 * k], [x - 5 * k, y - 6 * k], [x, y], [x + 5 * k, y - 6 * k], [x + 12 * k, y - 2 * k]], { color: "#3b4a58", weight: 2.4 * k, seed: 260 + i });
  }
}

function cloud(s: Sketch, at: Vec2, k: number): void {
  const [cx, cy] = at;
  // a flat-bottomed heap of puffs: radius swells over each lobe on the top
  const outline: Vec2[] = [];
  for (let i = 0; i <= 40; i += 1) {
    const a = Math.PI + (i / 40) * Math.PI;
    const lobe = Math.abs(Math.sin((i / 40) * Math.PI * 4.5));
    const r = 1 + lobe * 0.22;
    outline.push([cx + Math.cos(a) * 92 * k * r, cy + Math.sin(a) * 40 * k * r * (1 + lobe * 0.3)]);
  }
  outline.push([cx + 80 * k, cy + 12 * k], [cx - 80 * k, cy + 12 * k]);
  form(s, outline, { base: "#ffffff", shade: "#cfe0ee", depth: 12 * k });
  s.clip(s.curvePath(outline, true), () => {
    for (let j = 0; j < 4; j += 1) {
      const y = cy - 30 * k + j * 12 * k;
      mark(s, [[cx - 90 * k, y + 4], [cx, y - 2], [cx + 90 * k, y + 3]], {
        color: j < 2 ? "#ffffff" : "#c2d6e6", weight: 16 * k, brush: "bristle", opacity: 0.8, wobble: 2, seed: Math.round(cx) + j,
      });
    }
  });
  mark(s, [[cx - 84 * k, cy + 10 * k], [cx, cy + 14 * k], [cx + 84 * k, cy + 10 * k]], {
    color: "#a9c3d9", weight: 6 * k, brush: "ink", opacity: 0.7, seed: Math.round(cx) + 9,
  });
}

export function sea(s: Sketch): void {
  s.noStroke();
  s.fill(s.linearGradient(0, HORIZON, 0, QUAY, [[0, "#2f8fb8"], [1, "#4fb3c8"]]));
  s.rect(0, HORIZON, W, QUAY - HORIZON);
  for (let i = 0; i < 9; i += 1) {
    const y = HORIZON + 6 + i * 11;
    const x0 = -60 + hash(i + 20) * 160;
    mark(s, [[x0, y], [x0 + 420, y + 2], [x0 + 980, y]], {
      color: i % 2 === 0 ? "#1c6e98" : "#8adbe4", weight: 14, brush: "bristle", opacity: 0.8, wobble: 1.5, seed: 90 + i,
    });
  }
  // glitter under the sun
  for (let i = 0; i < 26; i += 1) {
    const x = 640 + hash(i + 3) * 260;
    const y = HORIZON + 6 + hash(i + 50) * 80;
    mark(s, [[x, y], [x + 10 + hash(i) * 14, y]], { color: "#fffbe0", weight: 2.5, seed: 200 + i });
  }
  boat(s, [560, HORIZON + 2], 1);
  boat(s, [400, HORIZON + 14], 0.6);
}

function boat(s: Sketch, at: Vec2, k: number): void {
  const [x, y] = at;
  const sail: Vec2[] = [[x, y - 70 * k], [x + 4 * k, y - 6 * k], [x + 40 * k, y - 8 * k]];
  form(s, sail, { base: "#fff3df", shade: "#e0cfb5", depth: 4, sharp: true, weight: 1.6 * k, seed: 3 });
  const hull: Vec2[] = [[x - 34 * k, y - 4 * k], [x + 48 * k, y - 4 * k], [x + 36 * k, y + 9 * k], [x - 26 * k, y + 9 * k]];
  form(s, hull, { base: "#d8483a", shade: "#93302a", depth: 3, sharp: true, weight: 1.8 * k, seed: 4 });
  mark(s, [[x + 1 * k, y - 72 * k], [x + 1 * k, y - 4 * k]], { color: INK, weight: 2 * k, pressure: "even" });
}

export function headland(s: Sketch): void {
  const hill: Vec2[] = [[-20, HORIZON + 4], [-20, 150], [60, 128], [150, 136], [230, 168], [300, 214], [330, HORIZON + 4]];
  form(s, hill, { base: "#7fb069", shade: "#4f8a4e", strokes: "#a8d38a", depth: 14, line: "#3c6a3e", weight: 2, seed: 11 });
  // little houses up the slope
  const colours = ["#f2c14e", "#f78154", "#e8eef2", "#5b8ec9", "#f2a3b3", "#e8eef2"];
  for (const [i, c] of colours.entries()) {
    const hx = 18 + i * 42;
    const hy = 150 + i * 9 + (i > 3 ? (i - 3) * 6 : 0);
    form(s, [[hx, hy], [hx + 30, hy], [hx + 30, hy + 30], [hx, hy + 30]], { base: c, shade: "#00000030", depth: 5, sharp: true, weight: 1.2, seed: 20 + i });
    form(s, [[hx - 3, hy + 1], [hx + 15, hy - 14], [hx + 33, hy + 1]], { base: "#9c4a3c", shade: "#6a2f27", depth: 3, sharp: true, weight: 1.2, seed: 30 + i });
    s.noStroke();
    s.fill("#2c4258");
    s.rect(hx + 10, hy + 9, 9, 9);
  }
  // lighthouse on the point
  const lx = 268;
  form(s, [[lx - 9, 196], [lx + 9, 196], [lx + 12, 236], [lx - 12, 236]], { base: "#fafafa", shade: "#c9d3dc", depth: 4, sharp: true, weight: 1.4, seed: 8 });
  s.noStroke();
  s.fill("#d8483a");
  s.rect(lx - 10, 208, 20, 8);
  s.rect(lx - 11, 224, 22, 8);
  form(s, [[lx - 7, 184], [lx + 7, 184], [lx + 7, 196], [lx - 7, 196]], { base: "#ffe27a", shade: "#e3b43c", depth: 2, sharp: true, weight: 1.2, seed: 9 });
  form(s, ring(lx, 182, 9, 5), { base: "#d8483a", shade: "#93302a", depth: 2, weight: 1.2 });
}

export function quay(s: Sketch): void {
  s.noStroke();
  s.fill(s.linearGradient(0, QUAY, 0, H, [[0, "#d9c6a2"], [1, "#c4a77c"]]));
  s.rect(0, QUAY, W, H - QUAY);
  // harbour wall lip along the water
  s.fill("#a78f6c");
  s.rect(0, QUAY - 4, W, 12);
  mark(s, [[0, QUAY + 8], [W / 2, QUAY + 9], [W, QUAY + 7]], { color: "#6f5a42", weight: 3, pressure: "even", wobble: 1, seed: 5 });
  // brushed flagstones: broad dry strokes, then pencil joints
  for (let i = 0; i < 18; i += 1) {
    const y = QUAY + 20 + i * 20;
    const x0 = -80 + hash(i + 7) * 200;
    mark(s, [[x0, y], [x0 + 500, y + 4], [x0 + 1000, y]], {
      color: i % 3 === 0 ? "#b0905f" : "#efe1c4", weight: 22, brush: "bristle", opacity: 0.75, wobble: 2, seed: 300 + i,
    });
  }
  for (let row = 0; row < 9; row += 1) {
    const y = QUAY + 26 + row * row * 4.2 + row * 10;
    mark(s, [[0, y], [W, y + 2]], { color: "#8a7254", weight: 2, brush: "pencil", pressure: "even", wobble: 1.5, seed: 400 + row });
    const step = 50 + row * 14;
    for (let x = (row % 2) * step * 0.5; x < W; x += step) {
      const h = 8 + row * 4.5;
      mark(s, [[x + hash(x + row) * 10, y], [x + hash(x) * 10 - 4, y + h]], { color: "#8a7254", weight: 1.8, brush: "pencil", wobble: 1, seed: 500 + row * 40 + x });
    }
  }
}

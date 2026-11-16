// A row of three market stalls at dusk. Two vendors share one picture in
// different coats; the middle one holds a lantern whose flame lights the row.
import type { BrushPreset, Msg, Style, View, Vec2 } from "@ianbicking/canvas-loop";

/** Draws with the scene View on the GPU renderer (`cli run` reads this). */
export const renderer = "scene";

export const canvas = { width: 720, height: 420 };

export interface Model {
  readonly frame: number;
}

export function init(): Model {
  return { frame: 0 };
}

export function update(model: Model, msg: Msg): Model {
  switch (msg.type) {
    case "tick":
      return { frame: msg.frame };
    case "mousedown":
    case "mouseup":
    case "mousemove":
    case "keydown":
    case "keyup":
    case "param":
    case "trigger":
      return model;
  }
}

const INK = "#2b2230";
const OUTLINE: Style = { stroke: INK, weight: 2, brush: "ink", gesture: { pressure: "taper", wobble: 0.8 } };
const BRISTLE: BrushPreset = { preset: "bristle", load: 0.7, lightJitter: 0.08, hueJitter: 6 };
const COUNTER_TOP = 300;
const STALLS = [
  { x: 30, cloth: "#b8433a", stripe: "#f0dcc0", goods: "fruit" },
  { x: 260, cloth: "#3f6f8a", stripe: "#e9e2cf", goods: "bread" },
  { x: 490, cloth: "#5f7d3c", stripe: "#efe4c4", goods: "pots" },
] as const;
const STALL_W = 200;

interface Look {
  readonly coat: string;
  readonly scarf: string;
  readonly hat: string;
}

/** One vendor from the waist up, without arms (they move): 100 × 140. */
function vendor(v: View, look: Look): void {
  const torso: Vec2[] = [[22, 64], [50, 56], [78, 64], [86, 140], [14, 140]];
  v.curve(torso, true, { fill: look.coat, material: { bevel: 10, relief: 0.4 } });
  v.clip(v.curvePath(torso, true), () => {
    for (let i = 0; i < 6; i += 1) {
      v.line(18 + i * 14, 70, 10 + i * 15, 142, { stroke: look.coat, weight: 14, brush: { ...BRISTLE, lightJitter: 0.14 } });
    }
    v.curve([[30, 60], [50, 80], [72, 60]], false, { stroke: look.scarf, weight: 12, brush: BRISTLE });
  });
  v.curve(torso, true, OUTLINE);
  v.rect(44, 44, 12, 14, { fill: "#d9a582" });
  v.ellipse(50, 32, 17, 20, { fill: "#e3b08c", stroke: INK, weight: 1.6, brush: "ink", material: { bevel: 8, relief: 0.5 } });
  v.curve([[44, 36], [45, 37]], false, { stroke: INK, weight: 2.4, brush: "ink" });
  v.curve([[56, 36], [57, 37]], false, { stroke: INK, weight: 2.4, brush: "ink" });
  v.curve([[45, 44], [50, 46], [55, 44]], false, { stroke: "#8a4a3a", weight: 1.4, brush: "ink" });
  v.path([["move", 28, 20], ["quad", 50, -2, 72, 20], ["line", 80, 22], ["line", 20, 22], ["close"]], { fill: look.hat, stroke: INK, weight: 1.6, brush: "ink" });
}

/** Draws an arm hanging from `shoulder`; returns the hand in canvas coordinates. */
function arm(v: View, a: { shoulder: Vec2; angle: number; elbow: number; coat: string }): Vec2 {
  let hand: Vec2 = a.shoulder;
  v.at({ translate: a.shoulder, rotate: a.angle }, () => {
    const upper: Vec2[] = [[0, 0], [0, 30]];
    v.at({ translate: [0, 30], rotate: a.elbow }, () => {
      v.path(v.tube([[0, 0], [0, 28]], { width: 11, profile: [[0, 1], [1, 0.85]] }), { fill: a.coat, stroke: INK, weight: 1.5, brush: "ink" });
      v.circle(0, 33, 6, { fill: "#e3b08c", stroke: INK, weight: 1.2, brush: "ink" });
      hand = v.toCanvas([0, 33]);
    });
    v.path(v.tube(upper, { width: 13 }), { fill: a.coat, stroke: INK, weight: 1.5, brush: "ink" });
  });
  return hand;
}

function stall(v: View, s: (typeof STALLS)[number]): void {
  const { x } = s;
  v.rect(x + 6, 120, 8, 220, { fill: "#6b4a30", stroke: INK, weight: 1.5, brush: "ink", material: { castsShadow: 40 } });
  v.rect(x + STALL_W - 14, 120, 8, 220, { fill: "#6b4a30", stroke: INK, weight: 1.5, brush: "ink", material: { castsShadow: 40 } });
  // Awning: stripes, then a scalloped edge.
  const top = 100;
  const drop = 50;
  v.polygon([[x - 6, top + drop], [x + 20, top], [x + STALL_W - 20, top], [x + STALL_W + 6, top + drop]], { fill: s.stripe });
  for (let i = 0; i < 7; i += 2) {
    const a = x - 6 + (i * (STALL_W + 12)) / 7;
    const b = x - 6 + ((i + 1) * (STALL_W + 12)) / 7;
    const ta = x + 20 + (i * (STALL_W - 40)) / 7;
    const tb = x + 20 + ((i + 1) * (STALL_W - 40)) / 7;
    v.polygon([[a, top + drop], [ta, top], [tb, top], [b, top + drop]], { fill: s.cloth });
    v.line((a + ta) / 2 + 4, top + 6, (b + tb) / 2 - 2, top + drop - 4, { stroke: s.cloth, weight: 16, brush: BRISTLE });
  }
  const scallops: Vec2[] = [];
  for (let i = 0; i <= 14; i += 1) {
    const sx = x - 6 + (i * (STALL_W + 12)) / 14;
    scallops.push([sx, top + drop + (i % 2 === 0 ? 0 : 10)]);
  }
  v.curve([[x - 6, top + drop], ...scallops, [x + STALL_W + 6, top + drop]], false, { stroke: s.cloth, weight: 5, brush: "ink" });
  v.polygon([[x - 6, top + drop], [x + 20, top], [x + STALL_W - 20, top], [x + STALL_W + 6, top + drop]], { stroke: INK, weight: 2, brush: "ink" });
}

function counter(v: View, s: (typeof STALLS)[number]): void {
  const { x } = s;
  v.rect(x - 4, COUNTER_TOP, STALL_W + 8, 70, { fill: "#8a5d3b", material: { castsShadow: 70, bevel: 4, relief: 0.3 } });
  for (let i = 0; i < 4; i += 1) {
    v.line(x, COUNTER_TOP + 12 + i * 16, x + STALL_W, COUNTER_TOP + 12 + i * 16, { stroke: "#5a3620", weight: 4, brush: { preset: "pencil", opacity: 1 } });
  }
  v.rect(x - 4, COUNTER_TOP, STALL_W + 8, 70, OUTLINE);
  const shine = { shine: 0.6, bevel: 6, relief: 0.6 };
  if (s.goods === "fruit") {
    for (let i = 0; i < 9; i += 1) {
      const fx = x + 22 + i * 20;
      const fy = COUNTER_TOP - 9 - (i % 3 === 1 ? 10 : 0);
      v.circle(fx, fy, 10, { fill: i % 2 === 0 ? "#d9822b" : "#c23b2e", stroke: INK, weight: 1.2, brush: "ink", material: shine });
    }
  } else if (s.goods === "bread") {
    for (let i = 0; i < 5; i += 1) {
      v.ellipse(x + 30 + i * 36, COUNTER_TOP - 10, 17, 10, { fill: "#c98b45", stroke: INK, weight: 1.3, brush: "ink", material: { bevel: 8, relief: 0.6 } });
      v.curve([[x + 22 + i * 36, COUNTER_TOP - 12], [x + 30 + i * 36, COUNTER_TOP - 15], [x + 38 + i * 36, COUNTER_TOP - 12]], false, { stroke: "#7a4a22", weight: 1.4, brush: "ink" });
    }
  } else {
    for (let i = 0; i < 4; i += 1) {
      const px = x + 36 + i * 44;
      const h = 30 + (i % 2) * 12;
      v.path([["move", px - 12, COUNTER_TOP], ["quad", px - 20, COUNTER_TOP - h * 0.6, px - 6, COUNTER_TOP - h], ["line", px + 6, COUNTER_TOP - h], ["quad", px + 20, COUNTER_TOP - h * 0.6, px + 12, COUNTER_TOP], ["close"]], { fill: i % 2 === 0 ? "#a65a3a" : "#3e6a75", stroke: INK, weight: 1.4, brush: "ink", material: shine });
    }
  }
}

/** Town houses across the square: gables, and a few windows lit from inside. */
function houses(v: View): void {
  const HOUSES = [
    { x: -20, w: 110, h: 150, c: "#6b5878" },
    { x: 90, w: 90, h: 120, c: "#7a6070" },
    { x: 180, w: 120, h: 170, c: "#5d5a7c" },
    { x: 300, w: 100, h: 135, c: "#735c6a" },
    { x: 400, w: 130, h: 160, c: "#62597a" },
    { x: 530, w: 95, h: 125, c: "#7d6474" },
    { x: 625, w: 115, h: 155, c: "#5e5776" },
  ];
  for (const [k, h] of HOUSES.entries()) {
    const base = 330;
    const top = base - h.h;
    v.polygon([[h.x, base], [h.x, top], [h.x + h.w / 2, top - 34], [h.x + h.w, top], [h.x + h.w, base]], { fill: h.c, stroke: "#3c3048", weight: 2, brush: { preset: "pencil", opacity: 0.8 } });
    v.line(h.x + 4, top, h.x + h.w / 2, top - 30, { stroke: h.c, weight: 18, brush: { ...BRISTLE, lightJitter: 0.12 } });
    for (let j = 0; j < 2; j += 1) {
      const lit = (k + j) % 3 === 0;
      v.rect(h.x + 18 + j * (h.w - 50), top + 18, 14, 20, lit ? { fill: "#ffd27a", material: { emissive: 0.9 } } : { fill: "#3e3550" });
    }
  }
}

function lantern(v: View, at: Vec2, flicker: number): void {
  const [hx, hy] = at;
  const lx = hx;
  const ly = hy + 34;
  v.line(hx, hy, lx, ly - 14, { stroke: INK, weight: 1.5 });
  v.light({ kind: "point", at: [lx, ly], height: 90, color: "#ffc070", energy: 4.5 + flicker * 1.5, reach: 520 });
  v.group({ effects: { glow: { blur: 18, color: "#ffb347", strength: 3 + flicker * 2 } } }, () => {
    v.ellipse(lx, ly + 2, 7, 11 + flicker * 3, { fill: "#ffe39a", material: { emissive: 1 } });
    v.ellipse(lx, ly + 2, 3, 5, { fill: "#fffbe8", material: { emissive: 1 } });
  });
  v.roundRect(lx - 12, ly - 14, 24, 30, 4, { stroke: "#3a2a1c", weight: 2.5, fill: "rgba(255,210,140,0.25)", material: { emissive: 0.6 } });
}

export function draw(v: View, model: Model): void {
  const t = model.frame / 30;
  const flicker = v.noise(t * 3);
  const blue = v.picture({ key: "vendor", width: 100, height: 140, deps: ["#2f4f7a", "#e0b84a", "#3a2a24"] }, () => vendor(v, { coat: "#2f4f7a", scarf: "#e0b84a", hat: "#3a2a24" }));
  const rust = v.picture({ key: "vendor", width: 100, height: 140, deps: ["#9a4a2a", "#e8e0c8", "#55613a"] }, () => vendor(v, { coat: "#9a4a2a", scarf: "#e8e0c8", hat: "#55613a" }));
  v.group({ name: "market", lighting: { ambient: "#3c4166", shadows: "soft", toneCurve: 0.5, exposure: 0.3 }, effects: { wash: { edges: 0.5, blotch: 0.35, granulate: 0.5, bleed: 2 }, paper: 0.25 } }, () => {
    // Past the canvas edges, so the wash's drying line is off-screen.
    v.rect(-40, -40, 800, 500, { fill: v.linearGradient(0, 0, 0, 300, [[0, "#3c4a78"], [0.6, "#c57d5a"], [1, "#e6b07a"]]) });
    houses(v);
    v.rect(-40, 326, 800, 134, { fill: "#a88a66" });
    for (let r = 0; r < 4; r += 1) {
      for (let i = 0; i < 26; i += 1) {
        const cx = i * 30 + (r % 2) * 15 - 10;
        v.ellipse(cx, 344 + r * 22, 13, 8, { stroke: "#4f3e30", weight: 3, brush: { preset: "pencil", opacity: 0.9 }, gesture: { wobble: 1.2 } });
      }
    }
    for (const s of STALLS) stall(v, s);
    // Vendors breathe: a small vertical scale about their waists.
    const breathe = (k: number): number => 1 + Math.sin(t * 2.2 + k) * 0.015;
    v.at({ translate: [80, 310], scale: [1, breathe(0)] }, () => v.place(blue, 0, -140, { material: { castsShadow: 90 } }));
    arm(v, { shoulder: [104, 236], angle: 2.4 + Math.sin(t * 4) * 0.35, elbow: 0.5, coat: "#2f4f7a" });
    arm(v, { shoulder: [156, 236], angle: 0.25, elbow: -1.2, coat: "#2f4f7a" });
    v.at({ translate: [540, 310], scale: [1, breathe(2)] }, () => v.place(rust, 0, -140, { material: { castsShadow: 90 } }));
    arm(v, { shoulder: [564, 236], angle: -0.2, elbow: 1.1, coat: "#9a4a2a" });
    arm(v, { shoulder: [616, 236], angle: 0.2, elbow: -1.1, coat: "#9a4a2a" });
    // The lantern vendor: an older woman in a shawl, drawn directly.
    v.at({ translate: [310, 310], scale: [1, breathe(1)] }, () => {
      const shawl: Vec2[] = [[24, -84], [50, -96], [76, -84], [90, 0], [10, 0]];
      v.curve(shawl, true, { fill: "#6a3f5c", material: { castsShadow: 90, bevel: 10, relief: 0.4 } });
      v.clip(v.curvePath(shawl, true), () => {
        for (let i = 0; i < 5; i += 1) v.curve([[10 + i * 20, -90], [20 + i * 18, -40], [8 + i * 22, 2]], false, { stroke: "#7c4c6c", weight: 16, brush: BRISTLE });
      });
      v.curve(shawl, true, OUTLINE);
      v.ellipse(50, -110, 16, 19, { fill: "#d9a988", stroke: INK, weight: 1.6, brush: "ink", material: { bevel: 8, relief: 0.5 } });
      v.curve([[34, -112], [36, -132], [50, -136], [64, -132], [66, -112]], false, { stroke: "#c9c3bd", weight: 9, brush: BRISTLE });
      v.curve([[44, -110], [45, -109]], false, { stroke: INK, weight: 2.2, brush: "ink" });
      v.curve([[56, -110], [57, -109]], false, { stroke: INK, weight: 2.2, brush: "ink" });
    });
    const hand = arm(v, { shoulder: [378, 228], angle: -1.7 + Math.sin(t * 1.3) * 0.04, elbow: 0.2, coat: "#6a3f5c" });
    lantern(v, hand, flicker);
    for (const s of STALLS) counter(v, s);
  });
}

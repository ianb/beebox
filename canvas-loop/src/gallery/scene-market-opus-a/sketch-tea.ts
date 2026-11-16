// A row of three market stalls at dusk. Two vendors share one picture in
// different colours; the middle one holds a lantern that lights the row.
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, Style, View, Vec2 } from "@ianbicking/canvas-loop";

export const canvas = { width: 720, height: 420 };
export const params = {
  wind: { type: "number", min: 0, max: 1, default: 0.5, step: 0.05, label: "lantern flicker" },
} as const satisfies ParamsDecl;

export interface Model {
  frame: number;
}

export function init(): Model {
  return { frame: 0 };
}

export function update(model: DeepReadonly<Model>, msg: Msg): Model {
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
      return { frame: model.frame };
  }
}

interface Vendor {
  readonly coat: string;
  readonly scarf: string;
  readonly skin: string;
  readonly hat: string;
}

const STALL_W = 220;
const COUNTER_Y = 300;
const STALLS = [
  { x: 20, awning: ["#b8432f", "#efe2c4"], goods: "#d98b2b" },
  { x: 250, awning: ["#2f5f7a", "#efe2c4"], goods: "#7a9a3c" },
  { x: 480, awning: ["#6c4a7e", "#efe2c4"], goods: "#c9473e" },
] as const;

const INK: Style = { stroke: "#2a1e18", weight: 2.2, brush: "ink", gesture: { wobble: 0.8 } };
const WOOD: Style = { fill: "#7a5233", stroke: "#3d2817", weight: 3, brush: { preset: "bristle", lightJitter: 0.08 } };

function paintVendor(v: View, who: Vendor): void {
  // Drawn in a 100×150 box; the counter hides everything below y = 130.
  const coat: Style = { fill: who.coat, stroke: "#2a1e18", weight: 2, brush: "ink" };
  v.curve([[12, 150], [18, 92], [50, 74], [82, 92], [88, 150]], true, coat);
  v.curve([[22, 110], [34, 88], [36, 140]], false, { stroke: "rgba(20,10,5,0.35)", weight: 10, brush: "wash" });
  v.curve([[34, 80], [50, 90], [66, 80]], false, { stroke: who.scarf, weight: 9, brush: { preset: "bristle", hueJitter: 8 } });
  v.ellipse(50, 52, 17, 20, { fill: who.skin, stroke: "#2a1e18", weight: 1.8, brush: "ink" });
  v.curve([[40, 60], [44, 66], [54, 66], [58, 60]], false, { stroke: "rgba(150,60,40,0.4)", weight: 6, brush: "wash" });
  v.circle(44, 50, 1.6, { fill: "#2a1e18" });
  v.circle(56, 50, 1.6, { fill: "#2a1e18" });
  v.curve([[45, 60], [50, 62], [55, 60]], false, { stroke: "#5a2a1e", weight: 1.4, brush: "ink" });
  v.path([["move", 28, 40], ["quad", 50, 14, 72, 40], ["line", 80, 42], ["line", 20, 42], ["close"]], {
    fill: who.hat, stroke: "#2a1e18", weight: 2, brush: "ink",
  });
}

function arm(v: View, from: Vec2, to: Vec2, coat: string): void {
  const outline = v.tube([from, [(from[0] + to[0]) / 2 + 4, (from[1] + to[1]) / 2 + 6], to], { width: 13, profile: [[0, 1], [1, 0.8]] });
  v.path(outline, { fill: coat, stroke: "#2a1e18", weight: 1.8, brush: "ink" });
  v.circle(to[0], to[1], 6, { fill: "#e0b48c", stroke: "#2a1e18", weight: 1.4, brush: "ink" });
}

function stall(v: View, s: (typeof STALLS)[number]): void {
  const { x } = s;
  v.rect(x + 8, 120, 10, COUNTER_Y - 120, WOOD);
  v.rect(x + STALL_W - 18, 120, 10, COUNTER_Y - 120, WOOD);
  // Striped awning with a scalloped hem.
  const stripes = 7;
  for (let i = 0; i < stripes; i += 1) {
    const sx = x + (i * STALL_W) / stripes;
    const w = STALL_W / stripes;
    const col = i % 2 === 0 ? s.awning[0] : s.awning[1];
    v.polygon([[sx + 4, 92], [sx + w + 4, 92], [sx + w, 132], [sx, 132]], { fill: col });
    v.arc(sx + w / 2, 132, w / 2, 0, Math.PI, { fill: col, stroke: "#2a1e18", weight: 1.5, brush: "ink" });
  }
  v.polygon([[x + 4, 92], [x + STALL_W + 4, 92], [x + STALL_W, 132], [x, 132]], INK);
}

function counter(v: View, s: (typeof STALLS)[number]): void {
  const { x } = s;
  v.rect(x - 4, COUNTER_Y, STALL_W + 8, 86, WOOD);
  for (let i = 1; i < 4; i += 1) v.line(x, COUNTER_Y + i * 21, x + STALL_W, COUNTER_Y + i * 21, { stroke: "#3d2817", weight: 2, brush: "pencil" });
  // Goods piled on the counter: a heap of round fruit.
  for (let i = 0; i < 9; i += 1) {
    const gx = x + 30 + (i % 5) * 18 + (i >= 5 ? 9 : 0);
    const gy = COUNTER_Y - 8 - (i >= 5 ? 13 : 0);
    v.circle(gx, gy, 9, { fill: s.goods, stroke: "#3a2010", weight: 1.4, brush: "ink" });
  }
  v.rect(x + 140, COUNTER_Y - 26, 52, 26, { fill: "#a87a48", stroke: "#3d2817", weight: 2, brush: "ink" });
}

const STARS: readonly Vec2[] = [[40, 30], [130, 58], [205, 22], [300, 44], [372, 16], [455, 60], [530, 28], [610, 50], [690, 20]];
const ROOFS: readonly Vec2[] = [[-30, 150], [-30, 80], [60, 80], [90, 50], [120, 80], [200, 80], [200, 62], [260, 62], [260, 86], [330, 86],
  [370, 46], [410, 86], [470, 86], [470, 66], [560, 66], [590, 40], [620, 66], [750, 66], [750, 150]];

function backdrop(v: View): void {
  // Past every edge, so the wash has no edge to dry against.
  v.rect(-30, -30, 780, 480, { fill: v.linearGradient(0, 0, 0, 300, [[0, "#2c3766"], [0.6, "#8a6a86"], [1, "#d9a679"]]) });
  for (const [sx, sy] of STARS) v.circle(sx, sy, 1.6, { fill: "#fff6d8", material: { emissive: 0.9 } });
  v.polygon(ROOFS, { fill: "#3a3550", stroke: "#2a2438", weight: 6, brush: { preset: "wash", opacity: 0.6 } });
  v.rect(-30, 384, 780, 66, { fill: "#5e4e40" });
  for (let i = 0; i < 26; i += 1) {
    v.ellipse(14 + i * 28 + (i % 2) * 10, 398 + (i % 3) * 6, 12, 5, { stroke: "#3b3028", weight: 2, brush: "pencil" });
  }
}

function hanging(v: View, x: number, color: string, phase: number): void {
  // A string of dried peppers hung from the awning frame, swaying slightly.
  v.at({ translate: [x, 134], rotate: 0.04 * Math.sin(phase) }, () => {
    v.line(0, 0, 0, 62, { stroke: "#4a3a22", weight: 1.5 });
    for (let k = 0; k < 5; k += 1) {
      const side = k % 2 === 0 ? -1 : 1;
      v.curve([[0, 8 + k * 11], [side * 8, 13 + k * 11], [side * 6, 26 + k * 11]], false, { stroke: color, weight: 9, brush: { preset: "bristle", lightJitter: 0.1 }, gesture: { pressure: "taper-out" } });
    }
  });
}

function lantern(v: View, at: Vec2, flicker: number): void {
  const [lx, ly] = at;
  v.line(lx, ly - 34, lx, ly - 20, { stroke: "#2a1e18", weight: 2 });
  v.group({ name: "flame", effects: { glow: { blur: 30, color: "#ffb347", strength: 5 } } }, () => {
    v.roundRect(lx - 12, ly - 20, 24, 34, 5, { fill: "rgba(255,214,140,0.85)", material: { emissive: 1 } });
    v.ellipse(lx, ly - 2 - flicker * 2, 4.5, 8 + flicker * 2, { fill: "#fff3c4", material: { emissive: 1 } });
  });
  v.roundRect(lx - 12, ly - 20, 24, 34, 5, { stroke: "#2a1e18", weight: 2, brush: "ink" });
  v.line(lx - 14, ly - 20, lx + 14, ly - 20, { stroke: "#2a1e18", weight: 3, cap: "round" });
  v.line(lx - 14, ly + 14, lx + 14, ly + 14, { stroke: "#2a1e18", weight: 3, cap: "round" });
  v.light({ kind: "point", at: [lx, ly], height: 60, color: "#ffc070", energy: 2.6 + flicker * 0.6, reach: 420 });
}

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): void {
  const t = model.frame / 30;
  v.background("#efe6d2");
  const flicker = (v.noise(t * 3) - 0.5) * 2 * p.wind;
  v.group({ name: "market", lighting: { ambient: "#3c4170", shadows: "soft", toneCurve: 0.5 }, effects: { wash: { granulate: 0.6, edges: 0.5, blotch: 0.3, bleed: 1.5 }, paper: 0.6 } }, () => {
    backdrop(v);
    for (const s of STALLS) stall(v, s);
    for (const [i, s] of STALLS.entries()) {
      hanging(v, s.x + 36, i === 1 ? "#e2a93b" : "#b8302a", t * 1.5 + i);
      hanging(v, s.x + 186, i === 2 ? "#e2a93b" : "#8a5a2a", t * 1.3 + i * 2);
    }
    // Two vendors share one picture in different colours.
    const red = v.picture({ key: "vendor", deps: ["#9e3b2c", "#e7c14a"], width: 100, height: 150 }, () =>
      paintVendor(v, { coat: "#9e3b2c", scarf: "#e7c14a", skin: "#d9a07a", hat: "#3d2b20" }));
    const green = v.picture({ key: "vendor", deps: ["#3f6b4a", "#c9473e"], width: 100, height: 150 }, () =>
      paintVendor(v, { coat: "#3f6b4a", scarf: "#c9473e", skin: "#b07a52", hat: "#5a4a2c" }));
    const blue = v.picture({ key: "vendor-tall", width: 100, height: 150 }, () =>
      paintVendor(v, { coat: "#3a4f7a", scarf: "#efe2c4", skin: "#e8c09c", hat: "#2f2a3a" }));
    const breath = (phase: number) => 1 + 0.015 * Math.sin(t * 2 + phase);
    const vendorAt = (x: number, phase: number, pic: typeof red) => {
      v.at({ translate: [x + 50, COUNTER_Y], scale: [1, breath(phase)] }, () => v.place(pic, -50, -150, { material: { castsShadow: 40 } }));
    };
    vendorAt(80, 0, red);
    vendorAt(310, 1.7, blue);
    vendorAt(540, 3.1, green);
    // Arms: the left vendor waves, the middle one holds the lantern up.
    const wave = Math.sin(t * 5) * 0.35;
    v.at({ translate: [158, COUNTER_Y - 64], rotate: 0.4 + wave }, () => arm(v, [0, 0], [0, -46], "#9e3b2c"));
    const lanternAt: Vec2 = [410, 200 + Math.sin(t * 2 + 1.7) * 2];
    arm(v, [378, COUNTER_Y - 62], [lanternAt[0], lanternAt[1] - 38], "#3a4f7a");
    for (const s of STALLS) counter(v, s);
    // The right vendor offers an apple across the counter.
    const reach = Math.sin(t * 1.3) * 4;
    arm(v, [564, COUNTER_Y - 62], [526 + reach, COUNTER_Y - 44], "#3f6b4a");
    v.circle(522 + reach, COUNTER_Y - 52, 9, { fill: "#c9473e", stroke: "#3a2010", weight: 1.4, brush: "ink" });
    lantern(v, lanternAt, flicker);
  });
}

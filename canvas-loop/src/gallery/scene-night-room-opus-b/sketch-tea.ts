// A sitting room at night, wider than the canvas. The camera drifts along it:
// a bookshelf, a reader at a table under a flickering ceiling lamp, a sofa,
// and a window full of moonlight. The whole room is one lit, washed group.
import type { BrushPreset, Msg, Style, View, Vec2 } from "@ianbicking/canvas-loop";

/** Draws with the scene View on the GPU renderer (`cli run` reads this). */
export const renderer = "scene";

export const canvas = { width: 640, height: 400 };

const ROOM_W = 1400;
const FLOOR = 312;
const INK = "#2a2633";
const LINE: Style = { stroke: INK, weight: 1.8, brush: "ink", gesture: { pressure: "taper", wobble: 0.7 } };
const BRISTLE: BrushPreset = { preset: "bristle", load: 0.6, lightJitter: 0.07, hueJitter: 5 };
const WASH: BrushPreset = { preset: "wash", opacity: 0.35 };

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

function walls(v: View): void {
  // The room runs past every canvas edge, so the wash's drying line falls off-screen.
  v.rect(-40, -40, ROOM_W + 80, FLOOR + 40, { fill: "#7d8a86" });
  for (let x = 10; x < ROOM_W; x += 46) v.line(x, 6, x + 3, FLOOR - 20, { stroke: "#6c7a78", weight: 30, brush: WASH, gesture: { pressure: 0.8, faint: true } });
  v.rect(-40, FLOOR, ROOM_W + 80, 440 - FLOOR, { fill: "#86603e" });
  for (let y = FLOOR + 14; y < 400; y += 18) v.line(0, y, ROOM_W, y + 2, { stroke: "#6a4a2e", weight: 2.5, brush: { preset: "pencil", opacity: 0.9 } });
  v.rect(-40, FLOOR - 18, ROOM_W + 80, 18, { fill: "#d8cbb2", stroke: INK, weight: 1.2, brush: "ink", material: { bevel: 3, relief: 0.4 } });
  // A rug under the table.
  v.ellipse(470, 365, 210, 26, { fill: "#8a3b34", stroke: "#5e2622", weight: 6, brush: BRISTLE });
  v.ellipse(470, 365, 170, 18, { stroke: "#d6a65a", weight: 3, brush: "ink" });
}

function bookshelf(v: View): void {
  v.rect(0, 0, 150, 250, { fill: "#5a3a26", stroke: INK, weight: 2, brush: "ink" });
  const SPINES = ["#8f3a2f", "#2f5a6f", "#c9a24a", "#4b6b3a", "#6a3f5c", "#b8673a", "#33465e"];
  for (let shelf = 0; shelf < 4; shelf += 1) {
    const y = 14 + shelf * 60;
    v.rect(10, y, 130, 50, { fill: "#3c2618" });
    let x = 14;
    for (let i = 0; x < 128; i += 1) {
      const w = 7 + ((i * 7 + shelf * 3) % 6);
      const h = 34 + ((i * 11 + shelf * 5) % 14);
      v.rect(x, y + 50 - h, w, h, { fill: SPINES[(i + shelf * 2) % SPINES.length] ?? "#888", stroke: INK, weight: 0.8, material: { bevel: 2, relief: 0.4 } });
      x += w + 1;
    }
    v.rect(6, y + 50, 138, 6, { fill: "#6e4a30" });
  }
}

function table(v: View): void {
  v.rect(0, 0, 200, 12, { fill: "#6b4428", stroke: INK, weight: 1.6, brush: "ink", material: { bevel: 4, relief: 0.5, shine: 0.3 } });
  v.rect(12, 12, 9, 62, { fill: "#5a3820", stroke: INK, weight: 1.2, brush: "ink" });
  v.rect(179, 12, 9, 62, { fill: "#5a3820", stroke: INK, weight: 1.2, brush: "ink" });
  v.path([["move", 150, 0], ["line", 152, -26], ["quad", 160, -32, 168, -26], ["line", 170, 0]], { fill: "#e7e0d0", stroke: INK, weight: 1.2, brush: "ink", material: { shine: 0.7, bevel: 3, relief: 0.6 } });
}

function sofa(v: View): void {
  const body: Vec2[] = [[0, 40], [20, 0], [240, 0], [260, 40], [262, 110], [-2, 110]];
  v.curve(body, true, { fill: "#41606b", material: { bevel: 14, relief: 0.6 } });
  v.clip(v.curvePath(body, true), () => {
    for (let i = 0; i < 9; i += 1) v.line(i * 32, 4, i * 32 + 10, 108, { stroke: "#4a6b76", weight: 24, brush: BRISTLE });
  });
  v.curve(body, true, LINE);
  v.roundRect(30, 46, 98, 40, 10, { fill: "#4a6c78", stroke: INK, weight: 1.4, brush: "ink", material: { bevel: 10, relief: 0.6 } });
  v.roundRect(134, 46, 98, 40, 10, { fill: "#4a6c78", stroke: INK, weight: 1.4, brush: "ink", material: { bevel: 10, relief: 0.6 } });
  v.roundRect(160, 22, 44, 34, 12, { fill: "#c9953f", stroke: INK, weight: 1.2, brush: "ink", material: { bevel: 12, relief: 0.8 } });
  v.rect(6, 110, 8, 10, { fill: INK });
  v.rect(248, 110, 8, 10, { fill: INK });
}

function windowView(v: View, stars: readonly Vec2[]): void {
  v.rect(0, 0, 180, 170, { fill: v.linearGradient(0, 0, 0, 170, [[0, "#14204a"], [1, "#3b5c8c"]]), material: { emissive: 0.9 } });
  v.circle(132, 42, 16, { fill: "#f3efd8", material: { emissive: 1 }, effects: { glow: { blur: 14, color: "#c9d8ff", strength: 2 } } });
  for (const [x, y] of stars) v.circle(x, y, 1.2, { fill: "#e8ecff", material: { emissive: 1 } });
  v.path([["move", 0, 150], ["line", 40, 128], ["line", 80, 140], ["line", 130, 118], ["line", 180, 136], ["line", 180, 170], ["line", 0, 170], ["close"]], { fill: "#0e1630", material: { emissive: 0.9 } });
  const FRAME: Style = { fill: "#e4dccb", stroke: INK, weight: 1.2, brush: "ink", material: { castsShadow: 12, bevel: 2, relief: 0.5 } };
  v.rect(-10, -10, 200, 10, FRAME);
  v.rect(-10, 170, 200, 12, FRAME);
  v.rect(-10, 0, 10, 170, FRAME);
  v.rect(180, 0, 10, 170, FRAME);
  v.rect(86, 0, 8, 170, FRAME);
  v.rect(0, 80, 180, 7, FRAME);
}

function curtain(v: View, x: number, flip: number): void {
  v.at({ translate: [x, 40], scale: [flip, 1] }, () => {
    const cloth: Vec2[] = [[0, 0], [44, 0], [36, 90], [20, 150], [30, 214], [0, 214]];
    v.curve(cloth, true, { fill: "#7a3f4a", material: { castsShadow: 20, bevel: 6, relief: 0.4 } });
    v.clip(v.curvePath(cloth, true), () => {
      for (let i = 0; i < 4; i += 1) v.curve([[6 + i * 10, 0], [10 + i * 7, 100], [4 + i * 8, 214]], false, { stroke: i % 2 === 0 ? "#5e2c38" : "#94505a", weight: 7, brush: BRISTLE });
    });
    v.curve(cloth, true, LINE);
  });
}

function reader(v: View, breath: number, page: number): void {
  // Seated, facing right, at the table's left end.
  v.rect(-26, 20, 52, 8, { fill: "#4b3020", stroke: INK, weight: 1.2, brush: "ink", material: { castsShadow: 60 } });
  v.rect(-22, 28, 6, 52, { fill: "#4b3020" });
  v.rect(18, 28, 6, 52, { fill: "#4b3020" });
  v.rect(-28, -50, 8, 72, { fill: "#4b3020", stroke: INK, weight: 1.2, brush: "ink" });
  v.path(v.tube([[-4, 22], [30, 24], [36, 74]], { width: 15 }), { fill: "#3d3a4a", stroke: INK, weight: 1.4, brush: "ink", material: { castsShadow: 40 } });
  v.at({ scale: [1, breath] }, () => {
    const torso: Vec2[] = [[-12, 22], [-14, -26], [0, -40], [14, -30], [14, 22]];
    v.curve(torso, true, { fill: "#b5583c", material: { castsShadow: 90, bevel: 8, relief: 0.5 } });
    v.curve(torso, true, LINE);
    v.circle(4, -54, 13, { fill: "#d7a684", stroke: INK, weight: 1.4, brush: "ink", material: { castsShadow: 110, bevel: 8, relief: 0.6 } });
    v.curve([[10, -56], [11, -55]], false, { stroke: INK, weight: 2, brush: "ink" });
    v.curve([[16, -52], [18, -49], [15, -48]], false, { stroke: "#8a5a44", weight: 1.2, brush: "ink" });
    v.curve([[-10, -56], [-6, -68], [6, -70], [16, -62]], false, { stroke: "#3a2a22", weight: 8, brush: BRISTLE });
    v.path(v.tube([[4, -28], [22, -8], [44, -22]], { width: 9 }), { fill: "#b5583c", stroke: INK, weight: 1.2, brush: "ink" });
  });
  v.at({ translate: [48, -24], rotate: -0.5 }, () => {
    v.polygon([[0, 0], [-14, -4 + page], [-14, 14 + page], [0, 18]], { fill: "#f0e8d6", stroke: INK, weight: 1, brush: "ink" });
    v.polygon([[0, 0], [14, -4], [14, 14], [0, 18]], { fill: "#f6efe0", stroke: INK, weight: 1, brush: "ink" });
  });
}

function lamp(v: View, flicker: number): void {
  v.line(0, 0, 0, 84, { stroke: INK, weight: 1.5 });
  v.light({ kind: "point", at: [0, 112], height: 140, color: "#ffc874", energy: 2.8 + flicker * 1.2, reach: 560 });
  // A warm haze under the shade, then the shade, then the bulb peeking below it.
  v.ellipse(0, 130, 120, 70, { fill: v.ellipseGradient(0, 130, 120, 70, [[0, `rgba(255,200,120,${(0.16 + 0.1 * flicker).toFixed(3)})`], [1, "rgba(255,200,120,0)"]]), blend: "screen", material: { emissive: 1 } });
  v.path([["move", -10, 84], ["line", 10, 84], ["line", 34, 108], ["line", -34, 108], ["close"]], { fill: "#d9b86c", stroke: INK, weight: 1.4, brush: "ink", material: { emissive: 0.5 + flicker * 0.2 } });
  v.ellipse(0, 110, 9, 6, { fill: "#fff6d0", material: { emissive: 1 }, effects: { glow: { blur: 22, color: "#ffc062", strength: 2 + flicker * 2 } } });
}

const STARS: readonly Vec2[] = Array.from({ length: 22 }, (_, i): Vec2 => [(i * 73) % 176 + 2, (i * 41) % 100 + 4]);

export function draw(v: View, model: Model): void {
  const t = model.frame;
  const camX = (ROOM_W - v.width) * (0.5 - 0.5 * Math.cos(t * 0.012));
  // Flicker: mostly steady, with brief dips.
  const n = v.noise(t * 0.15);
  const flicker = n > 0.35 ? 1 : n / 0.35;
  const shelf = v.picture({ key: "bookshelf", width: 150, height: 256 }, () => bookshelf(v));
  const tablePic = v.picture({ key: "table", width: 200, height: 74 }, () => table(v));
  const sofaPic = v.picture({ key: "sofa", width: 262, height: 120 }, () => sofa(v));
  v.at({ translate: [-camX, 0] }, () => {
    v.group({ name: "room", lighting: { ambient: "#2c3152", shadows: "soft", toneCurve: 0.6 }, effects: { wash: { edges: 0.6, blotch: 0.3, granulate: 0.3, bleed: 2.5 }, paper: 0.25 } }, () => {
      walls(v);
      v.place(shelf, 60, FLOOR - 250, { material: { castsShadow: 30 } });
      for (const [i, fx] of [700, 840].entries()) {
        v.rect(fx, 70, 70, 54, { fill: "#c6a35a", stroke: INK, weight: 1.4, brush: "ink", material: { castsShadow: 6 } });
        v.rect(fx + 8, 78, 54, 38, { fill: i === 0 ? "#6f8a6a" : "#9a6a54" });
        v.curve([[fx + 10, 108], [fx + 30, 92], [fx + 60, 104]], false, { stroke: "#e2d6b8", weight: 6, brush: WASH });
      }
      v.place(sofaPic, 640, FLOOR - 112, { material: { castsShadow: 70 } });
      v.place(tablePic, 380, FLOOR - 74, { material: { castsShadow: 60 } });
      v.at({ translate: [380, FLOOR - 74] }, () => reader(v, 1 + Math.sin(t * 0.09) * 0.012, Math.sin(t * 0.05) * 1.5));
      v.at({ translate: [1050, 60] }, () => windowView(v, STARS));
      v.rect(1000, 34, 280, 7, { fill: "#4a3020", stroke: INK, weight: 1, brush: "ink" });
      curtain(v, 1006, 1);
      curtain(v, 1274, -1);
      v.light({ kind: "spot", at: [1140, 120], height: 160, color: "#8fa8e8", energy: 1.4, direction: 2.2, cone: 0.7, reach: 700 });
      // A plant on the sill catches the moon from behind.
      v.path([["move", 1100, 204], ["line", 1126, 204], ["line", 1122, 230], ["line", 1104, 230], ["close"]], { fill: "#9a5a3a", stroke: INK, weight: 1.2, brush: "ink", material: { castsShadow: 40 } });
      for (let i = 0; i < 6; i += 1) v.curve([[1113, 206], [1100 + i * 6, 182 - (i % 3) * 8], [1090 + i * 9, 166 - (i % 2) * 14]], false, { stroke: "#3f6a3a", weight: 5, brush: "ink", material: { castsShadow: 60 } });
      v.at({ translate: [500, 0] }, () => lamp(v, flicker));
    });
  });
}

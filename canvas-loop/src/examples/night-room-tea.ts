// A lit room: a lamp and moonlight light the shapes in one lit group;
// materials give them bevels, shine and glowing windows; each caster's height
// sets how long its shadow falls; a film tone curve keeps the darks deep and
// the lamp's highlights soft. The lamp flickers with `v.noise`. Params switch
// the caster heights and the tone curve off, to compare, and move the lamp.
// Linked from BRUSHES.md "Lighting" and "Making something glow".
import type { DeepReadonly, Drawing, Msg, ParamValues, ParamsDecl, RootDrawing, Util, View } from "@ianbicking/canvas-loop";

export const params = {
  heights: { type: "select", options: ["varied", "all 32"], default: "varied", label: "Caster heights" },
  tone: { type: "select", options: ["film", "clip"], default: "film", label: "Tone curve" },
  lampX: { type: "number", min: 330, max: 500, step: 1, default: 400, label: "Lamp x" },
} as const satisfies ParamsDecl;

export const canvas = { width: 640, height: 380 };

export interface Model {
  frame: number;
}

export function init(_u: Util<typeof params>): Model {
  return { frame: 0 };
}

export function update(model: DeepReadonly<Model>, msg: Msg, _u: Util<typeof params>): Model {
  return msg.type === "tick" ? { frame: msg.frame } : model;
}

const FLOOR = 318;
/** A caster's `castsShadow`: its height, or `true` (32) to compare. */
type Caster = (height: number) => number | true;

const BOARDS = Array.from({ length: 12 }, (_, i) => -20 + i * 58);

function room(v: View): Drawing {
  // Plaster wall, a picture rail, a skirting board, a plank floor, a rug.
  return [
    v.rect(0, 0, 640, FLOOR, { fill: "#8d8578", material: { relief: 0.15 } }),
    v.rect(0, 92, 640, 4, { fill: "#6d6458" }),
    v.rect(0, FLOOR - 14, 640, 14, { fill: "#5d5247", material: { bevel: 3 } }),
    v.rect(0, FLOOR, 640, 62, { fill: "#6a4d38" }),
    BOARDS.map((x) => v.line(x, FLOOR + 2, x + 40, 380, { stroke: "rgba(30,20,14,0.35)", weight: 1 })),
    v.ellipse(330, 346, 170, 16, { fill: "#5a2f2c" }),
  ];
}

function windowAndMoon(v: View): Drawing {
  return [
    v.rect(36, 42, 112, 190, { fill: "#2f2a25", material: { bevel: 3 } }),
    v.rect(44, 50, 96, 174, { fill: v.linearGradient(0, 50, 0, 224, [[0, "#22324f"], [1, "#3b4766"]]), material: { emissive: 0.9 } }),
    v.circle(112, 82, 9, { fill: "#e9ecf2", material: { emissive: 1 } }),
    v.rect(90, 50, 4, 174, { fill: "#2f2a25" }),
    v.rect(44, 135, 96, 4, { fill: "#2f2a25" }),
  ];
}

function frame(v: View, cast: Caster): Drawing {
  return [
    v.rect(238, 112, 74, 54, { fill: "#3a2c20", material: { bevel: 3, castsShadow: cast(3) } }),
    v.rect(245, 119, 60, 40, { fill: "#6f7f74" }),
    v.polygon([[245, 159], [268, 132], [284, 148], [305, 128], [305, 159]], { fill: "#46564c" }),
  ];
}

const LEAVES: readonly [number, number, number, number][] = [[190, 250, 0.2, 34], [174, 236, -0.7, 30], [206, 232, 0.8, 32], [186, 212, -0.2, 28], [204, 204, 0.5, 26], [168, 206, -1.0, 24], [192, 186, 0.1, 22], [214, 262, 1.2, 24], [166, 262, -1.3, 24]];

function plant(v: View, cast: Caster): Drawing {
  const m = { castsShadow: cast(40) };
  return [
    v.path([["move", 176, 318], ["line", 206, 318], ["line", 210, 284], ["line", 172, 284], ["close"]], { fill: "#7a4a32", material: { bevel: 4, castsShadow: cast(40) } }),
    v.line(190, 286, 190, 196, { stroke: "#2c3a22", weight: 3, material: m }),
    LEAVES.map(([x, y, a, len]) => v.at({ translate: [x, y], rotate: a }, v.ellipse(0, -len / 2, 7, len / 2, { fill: "#3f5a30", material: m }))),
  ];
}

function chair(v: View, cast: Caster): Drawing {
  const m = { bevel: 9, relief: 0.4, shine: 0.1, castsShadow: cast(50) };
  return [
    v.roundRect(236, 196, 104, 92, 18, { fill: "#6b2e2a", material: m }),
    v.roundRect(222, 248, 30, 62, 10, { fill: "#5e2824", material: m }),
    v.roundRect(324, 248, 30, 62, 10, { fill: "#5e2824", material: m }),
    v.roundRect(244, 266, 92, 32, 8, { fill: "#73332e", material: m }),
    v.rect(232, 306, 6, 14, { fill: "#2a1d14", material: { castsShadow: cast(50) } }),
    v.rect(338, 306, 6, 14, { fill: "#2a1d14", material: { castsShadow: cast(50) } }),
  ];
}

/** The table lamp: its shade glows and its light dips as `flicker` (0.7–1.15) does. */
function lampTable(v: View, cast: Caster, at: { x: number; flicker: number }): Drawing {
  const { x, flicker } = at;
  const t = { castsShadow: cast(40) };
  return [
    v.rect(x - 34, 258, 68, 8, { fill: "#4a3424", material: { bevel: 2, ...t } }),
    v.rect(x - 28, 266, 5, 52, { fill: "#3c2a1d", material: t }),
    v.rect(x + 23, 266, 5, 52, { fill: "#3c2a1d", material: t }),
    // The lamp itself casts nothing: the light is in front of it, in the room.
    v.rect(x - 3, 226, 6, 32, { fill: "#2b2622", material: { shine: 0.5 } }),
    v.ellipse(x, 256, 13, 4, { fill: "#2b2622", material: { shine: 0.5 } }),
    v.path([["move", x - 16, 196], ["line", x + 16, 196], ["line", x + 25, 228], ["line", x - 25, 228], ["close"]], { fill: "#f2c47c", material: { emissive: Math.min(1, 0.85 * flicker) } }),
    v.light({ kind: "point", at: [x, 214], height: 150, color: "#ffc98a", energy: 3 * flicker, reach: 460 }),
  ];
}

const SPINES = ["#7b3b2e", "#2f4a5c", "#8a7a4a", "#4b5a3a", "#6a4e6e", "#a3683a", "#384048"];

/** Book widths and heights along one shelf, from the row number, until the shelf is full. */
function books(row: number): { x: number; w: number; h: number; colour: string }[] {
  const out: { x: number; w: number; h: number; colour: string }[] = [];
  for (let k = 0, x = 548; x < 620; k++) {
    const w = 6 + ((row * 7 + k * 5) % 6);
    out.push({ x, w, h: 34 + ((row * 3 + k * 11) % 16), colour: SPINES[(row * 3 + k) % SPINES.length] ?? "#555" });
    x += w + 1;
  }
  return out;
}

function shelf(v: View, cast: Caster): Drawing {
  const m = { castsShadow: cast(22) };
  return [
    v.rect(540, 74, 92, 244, { fill: "#3f2e22", material: { bevel: 3, ...m } }),
    [0, 1, 2, 3].map((row) => {
      const y = 132 + row * 58;
      return [
        v.rect(546, y, 80, 4, { fill: "#2c2018", material: m }),
        books(row).map((b) => v.rect(b.x, y - b.h, b.w, b.h, { fill: b.colour, material: { bevel: 1.5, ...m } })),
      ];
    }),
  ];
}

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): RootDrawing {
  const cast: Caster = p.heights === "varied" ? (h) => h : () => true;
  const flicker = 0.7 + 0.45 * v.noise(model.frame * 0.15, 4);
  return [
    v.background("#0b0b10"),
    v.group({ lighting: { ambient: "#151a28", shadows: "soft", exposure: 0.6, toneCurve: p.tone === "film" ? 0.9 : 0 } }, [
      room(v),
      windowAndMoon(v),
      frame(v, cast),
      shelf(v, cast),
      plant(v, cast),
      chair(v, cast),
      lampTable(v, cast, { x: p.lampX, flicker }),
      // Moonlight through the window: low, cool, raking to the right.
      v.light({ kind: "spot", at: [92, 130], height: 40, direction: 0.35, cone: 0.55, color: "#8fa6d8", energy: 0.35, reach: 520 }),
    ]),
  ];
}

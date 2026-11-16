// A room at night, lit by a table lamp and a little moonlight (draft R8):
// objects stand at different heights in front of the wall, so their shadows
// differ in length; a film tone curve keeps the darks deep and the lamp's
// highlights soft. Params switch caster heights and the tone curve off, to
// compare, and move the lamp.
import type { Drawing, Msg, ParamValues, ParamsDecl, RootDrawing, View } from "@ianbicking/canvas-loop";

export const params = {
  heights: { type: "select", options: ["varied", "all 32"], default: "varied", label: "Caster heights" },
  tone: { type: "select", options: ["film", "clip"], default: "film", label: "Tone curve" },
  lampX: { type: "number", min: 330, max: 450, step: 1, default: 392, label: "Lamp x" },
} as const satisfies ParamsDecl;

export const canvas = { width: 640, height: 380 };

export function init(): { frame: number } {
  return { frame: 0 };
}
export function update(model: { frame: number }, msg: Msg): { frame: number } {
  return msg.type === "tick" ? { frame: msg.frame } : model;
}

const FLOOR = 318;
/** A caster's `castsShadow`: its height, or `true` (32) to compare. */
type Caster = (height: number) => number | true;

function room(v: View): Drawing {
  const out: Drawing[] = [];
  // Plaster wall, a picture rail, a skirting board, a plank floor.
  out.push(v.rect(0, 0, 640, FLOOR, { fill: "#8d8578", material: { relief: 0.15 } }));
  out.push(v.rect(0, 92, 640, 4, { fill: "#6d6458" }));
  out.push(v.rect(0, FLOOR - 14, 640, 14, { fill: "#5d5247", material: { bevel: 3 } }));
  out.push(v.rect(0, FLOOR, 640, 62, { fill: "#6a4d38" }));
  for (let x = -20; x < 640; x += 58) out.push(v.line(x, FLOOR + 2, x + 40, 380, { stroke: "rgba(30,20,14,0.35)", weight: 1 }));
  out.push(v.ellipse(330, 346, 170, 16, { fill: "#5a2f2c" }));
  return out;
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

function plant(v: View, cast: Caster): Drawing {
  const out: Drawing[] = [];
  const m = { castsShadow: cast(40) };
  out.push(v.path([["move", 176, 318], ["line", 206, 318], ["line", 210, 284], ["line", 172, 284], ["close"]], { fill: "#7a4a32", material: { bevel: 4, castsShadow: cast(40) } }));
  const leaves: [number, number, number, number][] = [[190, 250, 0.2, 34], [174, 236, -0.7, 30], [206, 232, 0.8, 32], [186, 212, -0.2, 28], [204, 204, 0.5, 26], [168, 206, -1.0, 24], [192, 186, 0.1, 22], [214, 262, 1.2, 24], [166, 262, -1.3, 24]];
  out.push(v.line(190, 286, 190, 196, { stroke: "#2c3a22", weight: 3, material: m }));
  for (const [x, y, a, len] of leaves) {
    out.push(v.at({ translate: [x, y], rotate: a }, v.ellipse(0, -len / 2, 7, len / 2, { fill: "#3f5a30", material: m })));
  }
  return out;
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

function lampTable(v: View, cast: Caster, x: number): Drawing {
  const t = { castsShadow: cast(40) };
  return [
    v.rect(x - 34, 258, 68, 8, { fill: "#4a3424", material: { bevel: 2, ...t } }),
    v.rect(x - 28, 266, 5, 52, { fill: "#3c2a1d", material: t }),
    v.rect(x + 23, 266, 5, 52, { fill: "#3c2a1d", material: t }),
    // The lamp itself casts nothing: the light is in front of it, in the room.
    v.rect(x - 3, 226, 6, 32, { fill: "#2b2622", material: { shine: 0.5 } }),
    v.ellipse(x, 256, 13, 4, { fill: "#2b2622", material: { shine: 0.5 } }),
    v.path([["move", x - 16, 196], ["line", x + 16, 196], ["line", x + 25, 228], ["line", x - 25, 228], ["close"]], { fill: "#f2c47c", material: { emissive: 0.95 } }),
    v.light({ kind: "point", at: [x, 214], height: 150, color: "#ffc98a", energy: 3, reach: 460 }),
  ];
}

function figure(v: View, cast: Caster): Drawing {
  const m = { castsShadow: cast(70) };
  const coat = { fill: "#3a4658", material: { bevel: 7, relief: 0.3, castsShadow: cast(70) } };
  // Legs, a long coat, one arm bent with a cup, the other hanging; hair breaks the head's outline.
  return [
    v.polygon([[468, 250], [478, 318], [470, 318], [462, 252]], { fill: "#1f232b", material: m }),
    v.polygon([[488, 250], [494, 318], [486, 318], [480, 252]], { fill: "#1f232b", material: m }),
    v.path([["move", 462, 168], ["quad", 482, 158, 500, 168], ["line", 506, 262], ["line", 456, 262], ["close"]], coat),
    v.path([["move", 462, 172], ["quad", 448, 210, 452, 240], ["line", 458, 240], ["quad", 458, 210, 468, 182], ["close"]], coat),
    v.path([["move", 498, 172], ["quad", 512, 200, 506, 216], ["line", 488, 214], ["line", 490, 206], ["line", 500, 206], ["quad", 498, 190, 494, 180], ["close"]], coat),
    v.roundRect(484, 202, 9, 12, 2, { fill: "#d9d2c4", material: { shine: 0.4, castsShadow: cast(70) } }),
    v.rect(476, 150, 10, 14, { fill: "#b88b6a", material: m }),
    v.ellipse(481, 138, 13, 15, { fill: "#c39474", material: { bevel: 6, relief: 0.4, castsShadow: cast(70) } }),
    v.path([["move", 467, 136], ["quad", 470, 118, 486, 120], ["quad", 498, 122, 495, 140], ["quad", 492, 130, 486, 131], ["quad", 476, 126, 470, 144], ["close"]], { fill: "#2b1d16", material: m }),
  ];
}

function shelf(v: View, cast: Caster): Drawing {
  const out: Drawing[] = [];
  out.push(v.rect(540, 74, 92, 244, { fill: "#3f2e22", material: { bevel: 3, castsShadow: cast(22) } }));
  const colours = ["#7b3b2e", "#2f4a5c", "#8a7a4a", "#4b5a3a", "#6a4e6e", "#a3683a", "#384048"];
  for (let row = 0; row < 4; row++) {
    const y = 132 + row * 58;
    out.push(v.rect(546, y, 80, 4, { fill: "#2c2018", material: { castsShadow: cast(22) } }));
    let x = 548;
    for (let k = 0; x < 620; k++) {
      const w = 6 + ((row * 7 + k * 5) % 6);
      const h = 34 + ((row * 3 + k * 11) % 16);
      const lean = row === 2 && k === 5;
      const book = { fill: colours[(row * 3 + k) % colours.length] ?? "#555", material: { bevel: 1.5, castsShadow: cast(22) } };
      if (lean) out.push(v.at({ translate: [x, y], rotate: -0.35 }, v.rect(0, -h, w, h, book)));
      else out.push(v.rect(x, y - h, w, h, book));
      x += w + (lean ? 8 : 1);
    }
  }
  return out;
}

function foreground(v: View, cast: Caster): Drawing {
  // A sofa back close to the viewer, outside the lamp's reach: it hides the room's lower right corner.
  return v.path([["move", 560, 380], ["quad", 572, 336, 640, 330], ["line", 640, 380], ["close"]], { fill: "#2a2522", material: { bevel: 10, castsShadow: cast(120) } });
}

export function draw(v: View, _model: { frame: number }, p: ParamValues<typeof params>): RootDrawing {
  const out: Drawing[] = [];
  out.push(v.background("#0b0b10"));
  const cast: Caster = p.heights === "varied" ? (h) => h : () => true;
  const film = p.tone === "film";
  out.push(v.group({ lighting: { ambient: "#151a28", shadows: "soft", exposure: 0.6, toneCurve: film ? 0.9 : 0 } }, [
    room(v),
    windowAndMoon(v),
    frame(v, cast),
    shelf(v, cast),
    plant(v, cast),
    chair(v, cast),
    lampTable(v, cast, p.lampX),
    figure(v, cast),
    foreground(v, cast),
    // Moonlight through the window: low, cool, raking to the right.
    v.light({ kind: "spot", at: [92, 130], height: 40, direction: 0.35, cone: 0.55, color: "#8fa6d8", energy: 0.35, reach: 520 }),
  ]));
  return out;
}

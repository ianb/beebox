// A pale still life under a strong light from the left, so each object runs
// from highlight through half tone to core shadow, with cast shadows on the
// table: the look round's test for hatching (draft effects.hatching), where
// light areas stay bare, half tones take single lines and shadows cross.
import type { Msg, ParamsDecl, ParamValues, View } from "@ianbicking/canvas-loop";

export const params = {
  look: { type: "select", options: ["plain", "hatching"], default: "hatching", label: "Look" },
} as const satisfies ParamsDecl;

export const canvas = { width: 640, height: 480 };

export function init(): { frame: number } {
  return { frame: 0 };
}
export function update(model: { frame: number }, msg: Msg): { frame: number } {
  return msg.type === "tick" ? { frame: msg.frame } : model;
}

const TABLE = 318;

function room(v: View): void {
  // The wall falls off away from the light; the table top is lit, its front edge turned away.
  v.rect(0, 0, 640, TABLE, { fill: v.linearGradient(0, 0, 640, 0, [[0, "#f3f0ea"], [0.5, "#dedad2"], [1, "#b3aea5"]]) });
  v.rect(0, TABLE, 640, 130, { fill: v.linearGradient(0, 0, 640, 0, [[0, "#f6f3ee"], [0.6, "#d6d1c8"], [1, "#a29d93"]]) });
  v.rect(0, TABLE + 130, 640, 32, { fill: v.linearGradient(0, 0, 640, 0, [[0, "#7d786f"], [1, "#4a4741"]]) });
}

function shadows(v: View): void {
  // Cast shadows lie to the right of each object, darkest where they touch it.
  const shade = (x: number, w: number): ReturnType<View["linearGradient"]> => v.linearGradient(x, 0, x + w, 0, [[0, "rgba(40,38,34,0.75)"], [1, "rgba(40,38,34,0.15)"]]);
  v.group({ effects: { blur: 3 } }, () => {
    v.ellipse(250, 392, 120, 22, { fill: shade(170, 200) });
    v.polygon([[405, 350], [545, 338], [550, 362], [405, 372]], { fill: shade(405, 150) });
    v.polygon([[600, 352], [640, 348], [640, 376], [600, 376]], { fill: shade(600, 60) });
  });
}

function sphere(v: View): void {
  const [cx, cy, r] = [175, 318, 76];
  v.circle(cx, cy, r, { fill: v.radialGradient(cx - 34, cy - 36, 150, [[0, "#ffffff"], [0.18, "#ece8e1"], [0.42, "#b4afa6"], [0.62, "#5f5b55"], [0.74, "#4a4742"], [0.86, "#66625b"]]) });
}

function vase(v: View): void {
  const [x0, x1, top, bottom] = [330, 410, 170, 362];
  const body = v.linearGradient(x0, 0, x1, 0, [[0, "#d8d4cc"], [0.15, "#fbf9f5"], [0.38, "#d4d0c7"], [0.7, "#55524c"], [0.88, "#45423d"], [1, "#605c56"]]);
  v.path([["move", x0, top], ["line", x1, top], ["line", x1, bottom], ["quad", (x0 + x1) / 2, bottom + 16, x0, bottom], ["close"]], { fill: body });
  v.ellipse((x0 + x1) / 2, top, (x1 - x0) / 2, 9, { fill: "#e4e0d8" });
  v.ellipse((x0 + x1) / 2, top + 1, (x1 - x0) / 2 - 6, 6, { fill: "#4d4a45" });
}

function box(v: View): void {
  // Lit top, front face in half tone, the side away from the light in shadow.
  v.polygon([[470, 262], [560, 250], [605, 266], [515, 280]], { fill: "#f1eee8" });
  v.polygon([[470, 262], [515, 280], [515, 372], [470, 352]], { fill: v.linearGradient(470, 0, 515, 0, [[0, "#b8b3aa"], [1, "#a29d94"]]) });
  v.polygon([[515, 280], [605, 266], [605, 356], [515, 372]], { fill: v.linearGradient(515, 0, 605, 0, [[0, "#4b4843"], [1, "#5d5953"]]) });
}

function scene(v: View): void {
  room(v);
  shadows(v);
  sphere(v);
  vase(v);
  box(v);
}

export function draw(v: View, _model: { frame: number }, p: ParamValues<typeof params>): void {
  if (p.look === "hatching") v.group({ effects: { hatching: { amount: 1 } } }, () => scene(v));
  else scene(v);
}

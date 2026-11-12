// Effects, masks, blends and tween in one small night scene:
//
//   - distant hills under `effects: { blur }`
//   - a lamp whose light is a `glow` composited with `blend: "screen"`
//   - a sign card lifted off the wall with a `shadow`
//   - the lake's reflection of the lamp, faded downward by `v.mask` with a gradient
//   - a firefly whose path is `v.tweenPoint` keyframes with eases, drawn with `blend: "add"`
//   - an old photo inset with `saturation` and `sepia`
//
// `draw` only paints; `update` only counts frames. See TEA.md and BRUSHES.md.
import type { DeepReadonly, Msg, Util, View, Vec2 } from "@ianbicking/canvas-loop";

export const canvas = { width: 480, height: 320 };

export interface Model {
  frame: number;
}

export function init(_u: Util): Model {
  return { frame: 0 };
}

export function update(model: DeepReadonly<Model>, msg: Msg, _u: Util): Model {
  return msg.type === "tick" ? { frame: model.frame + 1 } : { ...model };
}

const HILLS: Vec2[] = [
  [0, 190],
  [70, 150],
  [150, 175],
  [240, 130],
  [330, 170],
  [410, 140],
  [480, 165],
  [480, 210],
  [0, 210],
];

// The firefly loops every 120 frames: out along the shore, up, and back.
const FLIGHT: readonly (readonly [number, readonly number[]])[] = [
  [0, [300, 150]],
  [40, [430, 130]],
  [70, [400, 100]],
  [120, [300, 150]],
];

function sky(v: View): void {
  v.background(v.linearGradient(0, 0, 0, 210, [
    [0, "#0b1030"],
    [1, "#2a2f5a"],
  ]));
  v.group({ effects: { blur: 3 }, opacity: 0.9 }, () => v.polygon(HILLS, { fill: "#1b2140" }));
}

function lake(v: View): void {
  v.rect(0, 210, 480, 110, { fill: "#101633" });
  // The lamp's reflection, fading out as it goes down into the water.
  const fade = v.linearGradient(0, 210, 0, 320, [
    [0, "rgba(0,0,0,0.8)"],
    [1, "rgba(0,0,0,0)"],
  ]);
  v.mask(
    () => v.rect(0, 210, 480, 110, { fill: fade }),
    () => v.group({ effects: { blur: 4 } }, () => v.rect(222, 214, 16, 90, { fill: "#ffd84a" })),
  );
}

function lamp(v: View): void {
  v.rect(227, 110, 6, 100, { fill: "#30344f" });
  v.group({ effects: { glow: { blur: 18, color: "#ffd84a", strength: 3 } }, blend: "screen" }, () => {
    v.circle(230, 104, 18, { fill: "#fff2b0" });
  });
}

function sign(v: View): void {
  v.group({ effects: { shadow: { x: 5, y: 7, blur: 6, color: "rgba(0,0,0,0.55)" } } }, () => {
    v.roundRect(330, 30, 120, 54, 6, { fill: "#f3ead2" });
    v.text("Night Lake", { x: 390, y: 57 }, { size: 16, align: "center", valign: "middle", fill: "#3a2f1c" });
  });
}

function photo(v: View): void {
  v.group({ effects: { saturation: 0.2, sepia: 0.6, shadow: { x: 3, y: 4, blur: 4, color: "rgba(0,0,0,0.5)" } } }, () => {
    v.rect(20, 30, 110, 80, { fill: "#ffffff" });
    v.rect(26, 36, 98, 56, { fill: "#4aa3df" });
    v.circle(95, 55, 14, { fill: "#ffcc33" });
    v.polygon([[26, 92], [60, 66], [90, 92]], { fill: "#2e8b57" });
    v.text("summer", { x: 75, y: 101 }, { size: 9, align: "center", valign: "middle", fill: "#444444" });
  });
}

function firefly(v: View, frame: number): void {
  const [x = 0, y = 0] = v.tweenPoint(FLIGHT, frame % 120, "in-out");
  const pulse = v.tween([[0, 0.4], [10, 1], [20, 0.4]], frame % 20);
  v.group({ effects: { glow: { blur: 10, color: "#b7ff5a", strength: 5 } }, blend: "add", opacity: pulse }, () => {
    v.circle(x, y, 8, { fill: "#e8ffb0" });
  });
}

export function draw(v: View, model: DeepReadonly<Model>): void {
  sky(v);
  lake(v);
  lamp(v);
  sign(v);
  photo(v);
  firefly(v, model.frame);
}

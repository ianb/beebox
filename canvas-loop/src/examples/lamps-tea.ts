// Event-time animation: a click on a lamp records the frame it was lit, per
// lamp. Everything after is a pure function of `frame - litAt[id]` through
// `v.tween` (the bulb catches, dips, then warms up; the pool of light on the
// path spreads), so `update` keeps no animation state. Linked from TEA.md
// "Other `View` members" (`tween`) and BRUSHES.md "Animation and pictures".
import type { DeepReadonly, Drawing, Msg, RootDrawing, Util, Vec2, View } from "@ianbicking/canvas-loop";

export const canvas = { width: 520, height: 320 };

const IDS = ["a", "b", "c"] as const;
type Id = (typeof IDS)[number];
const X: Record<Id, number> = { a: 110, b: 260, c: 410 };
const GROUND = 250;
const GLASS = (x: number): Vec2[] => [[x - 14, 88], [x + 14, 88], [x + 10, 118], [x - 10, 118]];

export interface Model {
  frame: number;
  /** The frame each lamp was lit on, or null while it is dark. */
  litAt: Record<Id, number | null>;
}

export function init(u: Util): Model {
  return { frame: 0, litAt: u.record(IDS, () => null) };
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util): Model {
  switch (msg.type) {
    case "tick":
      return { ...model, frame: msg.frame };
    case "mousedown": {
      const id = IDS.find((i) => msg.targets.includes(`lamp-${i}`));
      if (id === undefined || model.litAt[id] !== null) return model;
      u.handled(`light ${id}`);
      // Events for frame N run before its tick: the model still holds N - 1, so the lamp starts on frame N.
      return { ...model, litAt: { ...model.litAt, [id]: model.frame + 1 } };
    }
    case "mouseup":
    case "mousemove":
    case "keydown":
    case "keyup":
    case "param":
    case "mouseleave":
    case "trigger":
      return model;
  }
}

function lamp(v: View, id: Id, since: number | null): Drawing {
  const x = X[id];
  const t = since ?? -1;
  // The bulb catches, dips, and warms to full over a second.
  const glow = v.tween([[0, 0], [4, 0.7], [9, 0.25], [50, 1]], t, "out");
  const pool = v.tween([[0, 0], [60, 1]], t, "in-out");
  return [
    v.group({ opacity: pool, blend: "screen" }, v.ellipse(x, GROUND + 8, 90, 22, { fill: v.ellipseGradient(x, GROUND + 8, 90, 22, [[0, "rgba(255,200,120,0.8)"], [1, "rgba(255,196,110,0)"]]) })),
    v.rect(x - 3, 118, 6, GROUND - 118, { fill: "#1d1b22" }),
    v.at({ name: `lamp-${id}` }, [
      // A larger transparent box under the name gives a fingertip room.
      v.rect(x - 24, 74, 48, 60, { fill: "transparent" }),
      v.polygon(GLASS(x), { fill: "#3b3a44" }),
      glow > 0 && v.group({ opacity: glow, effects: { glow: { blur: 16, color: "#ffb04a", strength: 3 } } }, v.polygon(GLASS(x), { fill: "#ffd98a" })),
      v.polygon([[x - 18, 88], [x, 76], [x + 18, 88]], { fill: "#1d1b22" }),
    ]),
  ];
}

export function draw(v: View, model: DeepReadonly<Model>): RootDrawing {
  return [
    v.background(v.linearGradient(0, 0, 0, GROUND, [[0, "#1b2240"], [0.7, "#4b4a72"], [1, "#9a7a8a"]])),
    v.polygon([[0, 200], [90, 170], [180, 188], [300, 160], [420, 184], [520, 168], [520, GROUND], [0, GROUND]], { fill: "#2a2b40" }),
    v.rect(0, GROUND, 520, 70, { fill: "#3a3542" }),
    IDS.map((id) => {
      const at = model.litAt[id];
      return lamp(v, id, at === null ? null : model.frame - at);
    }),
    v.text("Click a lamp to light it.", { x: 16, y: 16 }, { size: 13, fill: "#c9c3d8" }),
  ];
}

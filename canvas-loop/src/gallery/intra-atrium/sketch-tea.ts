// The Hollow Atrium (intra-game): "A vast, empty space beneath a frozen sunset."
// The room and its light are computed per pixel (room-tea.ts); the statues and the
// one visitor are painted (figures-tea.ts); dust drifts in the light.
import type { DeepReadonly, Drawing, Msg, RootDrawing, View } from "@ianbicking/canvas-loop";
import { STATUES, VISITOR, paintFigures, paintMotes } from "./figures-tea.js";
import { H, W, paintRoom } from "./room-tea.js";

export const canvas = { width: W, height: H };

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
      return model;
  }
}

export function draw(v: View, model: DeepReadonly<Model>): RootDrawing {
  const out: Drawing[] = [];
  out.push(v.place(v.picture({ key: "room", width: v.width, height: v.height }, () => paintRoom(v, [...STATUES, VISITOR])), 0, 0));
  out.push(v.place(v.picture({ key: "figures", width: v.width, height: v.height }, () => paintFigures(v)), 0, 0));
  // Warm haze in the air where the screen's light falls, drifting very slowly.
  const drift = Math.sin(model.frame * 0.01) * 12;
  out.push(v.ellipse(560 + drift, 430, 420, 260, { fill: v.ellipseGradient(560 + drift, 430, 420, 260, [[0, "rgba(255,170,100,0.13)"], [1, "rgba(255,170,100,0)"]]), blend: "screen" }));
  out.push(paintMotes(v, model.frame));
  // Darken the edges a little, toward the rock.
  out.push(v.rect(0, 0, W, H, { fill: v.ellipseGradient(W / 2, H * 0.55, W * 0.62, H * 0.62, [[0.6, "rgba(10,5,15,0)"], [1, "rgba(10,5,15,0.55)"]]) }));
  return out;
}

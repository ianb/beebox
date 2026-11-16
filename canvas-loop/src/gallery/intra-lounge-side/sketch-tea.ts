// The Archive Lounge (intra-game) from the side, as a cross-section, drawn by hand.
// The still room is drawn once and kept (scene-tea.ts); each frame the light, the
// screens and the walker are drawn over it (live-tea.ts), then the foreground.
import type { DeepReadonly, Msg, RootDrawing, View } from "@ianbicking/canvas-loop";
import { paintLive } from "./live-tea.js";
import { H, W, foreground, paintRoom } from "./scene-tea.js";

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
  return [
    v.place(v.picture({ key: "room", width: v.width, height: v.height }, () => paintRoom(v)), 0, 0),
    paintLive(v, model.frame),
    v.place(v.picture({ key: "front", width: v.width, height: v.height }, () => foreground(v)), 0, 0),
    v.rect(0, 0, W, H, { fill: v.ellipseGradient(W / 2, H * 0.48, W * 0.66, H * 0.66, [[0.65, "rgba(10,8,14,0)"], [1, "rgba(10,8,14,0.55)"]]) }),
  ];
}

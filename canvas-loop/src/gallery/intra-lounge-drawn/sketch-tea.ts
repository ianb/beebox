// The Archive Lounge (intra-game), drawn by hand: "A small, quiet room lined with
// old, glitching monitors displaying unreadable data. A vending machine hums quietly
// in the corner, offering unlabeled drinks."
// The room is drawn once (room-tea.ts) and kept; each frame the screens, glows and
// lights are drawn over it (light-tea.ts).
import type { DeepReadonly, Msg, View } from "@ianbicking/canvas-loop";
import { paintLight } from "./light-tea.js";
import { paintRoom } from "./room-tea.js";

/** Draws with the scene View on the GPU renderer (`cli run` reads this). */
export const renderer = "scene";

export const canvas = { width: 1200, height: 860 };

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

export function draw(v: View, model: DeepReadonly<Model>): void {
  v.place(v.picture({ key: "room", width: v.width, height: v.height }, () => paintRoom(v)), 0, 0);
  paintLight(v, model.frame);
  v.rect(0, 0, 1200, 860, { fill: v.ellipseGradient(600, 470, 720, 560, [[0.6, "rgba(10,8,14,0)"], [1, "rgba(10,8,14,0.6)"]]) });
}

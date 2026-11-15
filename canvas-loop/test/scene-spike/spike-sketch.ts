// A small TEA sketch drawn with the draft 2.2 View, for the spike runner's tests.
import type { Msg, View } from "../../src/scene-draft/scene-api.js";

export const canvas = { width: 160, height: 120 };

export function init(): { t: number } {
  return { t: 0 };
}

export function update(model: { t: number }, msg: Msg): { t: number } {
  return msg.type === "tick" ? { t: model.t + 1 } : model;
}

export function draw(v: View, model: { t: number }): void {
  v.background("#f4efe4");
  v.at({ translate: [80, 60], rotate: model.t * 0.1 }, () => v.rect(-30, -20, 60, 40, { fill: "#2a9d8f", stroke: "#264653", weight: 3 }));
  v.group({ effects: { glow: { blur: 4, color: "#ffd166" } } }, () => v.circle(30, 30, 12, { fill: "#e63946" }));
  v.log("t", model.t);
}

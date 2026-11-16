// A small TEA sketch drawn with the draft 2.2 View, for the scene runner's tests.
import type { Drawing, Msg, RootDrawing, View } from "../../src/core/tea.js";

export const canvas = { width: 160, height: 120 };
export const params = { speed: { type: "number", min: 0, max: 2, default: 1 } } as const;

export function init(): { t: number } {
  return { t: 0 };
}

export function update(model: { t: number }, msg: Msg): { t: number } {
  return msg.type === "tick" ? { t: model.t + 1 } : model;
}

export function draw(v: View, model: { t: number }): RootDrawing {
  const out: Drawing[] = [];
  out.push(v.background("#f4efe4"));
  out.push(v.at({ translate: [80, 60], rotate: model.t * 0.1 }, v.rect(-30, -20, 60, 40, { fill: "#2a9d8f", stroke: "#264653", weight: 3 })));
  out.push(v.group({ effects: { glow: { blur: 4, color: "#ffd166" } } }, v.circle(30, 30, 12, { fill: "#e63946" })));
  out.push(v.curve([[10, 100], [60, 90], [110, 108]], false, { stroke: "#1d2a44", weight: 5, brush: "pencil" }));
  out.push(v.place(v.picture({ key: "badge", width: 30, height: 16 }, () => v.rect(0, 0, 30, 16, { fill: "#2a9d8f" })), 120, 96));
  out.push(v.text(`t ${model.t}`, { x: 120, y: 10 }, { size: 12 }));
  // Logs on one frame only, so the capture test can show a logged frame is captured and others are skipped.
  if (model.t === 2) v.log("t", model.t);
  return out;
}

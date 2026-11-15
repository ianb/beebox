import type { DeepReadonly, Msg, ParamsDecl, ParamValues, SceneView as View, Util } from "@ianbicking/canvas-loop";

/** Draws with the scene View on the GPU renderer (`cli run` reads this). */
export const renderer = "scene";

export const canvas = { width: 620, height: 460 };
export const params = {
  length: { type: "number", min: 0.5, max: 2, default: 1.2, step: 0.05,
    label: "Length (m)", panel: false },
} as const satisfies ParamsDecl;
export interface Model { frame: number }
export function init(): Model { return { frame: 0 }; }
export function update(model: DeepReadonly<Model>, msg: Msg, _u: Util<typeof params>): Model {
  switch (msg.type) {
    case "tick": return { frame: msg.frame };
    case "mousedown": case "mouseup": case "mousemove": case "keydown":
    case "keyup": case "param": case "trigger": return model;
  }
}

const PIVOT = { x: 310, y: 111 };
const RAD = Math.PI / 180;

function bob(v: View, angle: number, length: number, alpha = 1): void {
  const x = PIVOT.x + Math.sin(angle) * length;
  const y = PIVOT.y + Math.cos(angle) * length;
  v.line(PIVOT.x, PIVOT.y, x, y, { stroke: `rgba(47,72,88,${alpha})`, weight: 2.5 });
  v.circle(x, y, 18, { fill: `rgba(43,128,151,${alpha})`, stroke: `rgba(19,65,83,${alpha})`, weight: 2 });
  v.circle(x - 5, y - 6, 4, { fill: `rgba(245,252,252,${alpha * 0.8})` });
}

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): void {
  v.background("#f9fbfa");
  const length = 135 + (p.length - 0.5) * 30;
  const period = 2 * Math.PI * Math.sqrt(p.length / 9.81);
  const amplitude = 28 * RAD;
  const phase = model.frame / (period * 10);
  const angle = amplitude * Math.cos(phase);

  v.rect(0, 0, 620, 59, { fill: "#e8f1f1" });
  v.line(0, 59, 620, 59, { stroke: "#c3d4d6", weight: 1 });
  v.text("THE SIMPLE PENDULUM", { x: 30, y: 17 },
    { font: "Georgia, serif", size: 23, style: "bold", fill: "#1a4051" });
  v.text("Length sets the rhythm", { x: 31, y: 43 },
    { font: "Arial, sans-serif", size: 12, fill: "#5a7178" });

  // Scale arc and regular ten-degree marks.
  v.arc(PIVOT.x, PIVOT.y, length + 36, (90 - 31) * RAD, (90 + 31) * RAD,
    { stroke: "#c6d5d9", weight: 1.2 });
  for (let degree = -30; degree <= 30; degree += 5) {
    const a = degree * RAD;
    const major = degree % 10 === 0;
    const r1 = length + 30;
    const r2 = length + (major ? 45 : 39);
    v.line(PIVOT.x + Math.sin(a) * r1, PIVOT.y + Math.cos(a) * r1,
      PIVOT.x + Math.sin(a) * r2, PIVOT.y + Math.cos(a) * r2,
      { stroke: major ? "#617b85" : "#9ab0b7", weight: major ? 1.7 : 1 });
    if (degree % 20 === 0) v.text(`${degree}°`,
      { x: PIVOT.x + Math.sin(a) * (length + 58), y: PIVOT.y + Math.cos(a) * (length + 58) },
      { size: 11, fill: "#607985", align: "center", valign: "middle" });
  }

  // A restrained motion trail, fading toward the oldest position.
  for (let i = 8; i >= 1; i -= 1) {
    const old = amplitude * Math.cos(phase - i * 0.11);
    const x = PIVOT.x + Math.sin(old) * length;
    const y = PIVOT.y + Math.cos(old) * length;
    v.circle(x, y, 13 - i * 0.35, { fill: `rgba(45,141,169,${(9 - i) * 0.018})` });
  }
  v.line(255, 104, 365, 104, { stroke: "#60747b", weight: 7, cap: "round" });
  v.circle(PIVOT.x, PIVOT.y, 7, { fill: "#274e60", stroke: "#f8fbfa", weight: 2 });
  bob(v, angle, length);

  const label = `Period  ${period.toFixed(2)} s`;
  const opts = { font: "Arial, sans-serif", size: 17, style: "bold" as const, fill: "#173e52" };
  const measured = v.textBounds(label, { x: 0, y: 0 }, opts);
  const boxW = measured.w + 30;
  const boxX = (620 - boxW) / 2;
  v.roundRect(boxX, 377, boxW, 43, 9,
    { fill: "#e1f0f0", stroke: "#7da5ab", weight: 1.4 });
  v.text(label, { x: 310, y: 398 },
    { ...opts, align: "center", valign: "middle" });

  v.line(34, 352, 586, 352, { stroke: "#d2dfe0", weight: 1 });
  v.text("SHORTER", { x: 40, y: 362 }, { size: 10, fill: "#70848b" });
  v.text("LONGER", { x: 580, y: 362 }, { size: 10, fill: "#70848b", align: "right" });
  v.control("length", { x: 177, y: 425, w: 266, h: 28, size: 13 });
}

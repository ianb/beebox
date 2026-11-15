import type { View, Vec2 } from "../../scene-api.js";
import type { ParamsDecl } from "../../../core/tea.js";

export const canvas = { width: 500, height: 450 };

export const params = {
  length: { type: "number", min: 0.5, max: 2.5, default: 1.4, step: 0.05,
    control: "slider", label: "Pendulum length", panel: false },
} as const satisfies ParamsDecl;

export interface Model {
  length: number;
  frame: number;
  pastAngles: readonly number[];
}

const CX = 245;
const CY = 109;
const G = 9.81;
const PX_PER_METER = 103;

function bobPosition(length: number, angle: number): Vec2 {
  const radius = length * PX_PER_METER;
  return [CX + Math.sin(angle) * radius, CY + Math.cos(angle) * radius];
}

function drawScale(v: View, length: number): void {
  const x = 433;
  const top = 132;
  const bottom = 340;
  v.line(x, top, x, bottom, { stroke: "#71859a", weight: 1 });
  for (let cm = 0; cm <= 200; cm += 10) {
    const y = top + cm * (bottom - top) / 200;
    const major = cm % 50 === 0;
    v.line(x - (major ? 13 : 7), y, x + 2, y, { stroke: "#71859a", weight: major ? 1.5 : 1 });
    if (major) v.text(`${(cm / 100).toFixed(1)} m`, { x: x + 9, y }, {
      size: 11, fill: "#50647c", valign: "middle",
    });
  }
  const markerY = top + Math.min(2, length) * 100 * (bottom - top) / 200;
  v.triangle(x - 24, markerY - 6, x - 14, markerY, x - 24, markerY + 6, { fill: "#147c88" });
  v.text("LENGTH", { x: x - 16, y: 102 }, {
    size: 10, fill: "#50647c", align: "center", style: "bold",
  });
}

function drawTrail(v: View, trail: { angles: readonly number[]; length: number }): void {
  const { angles, length } = trail;
  const count = angles.length;
  for (const [index, angle] of angles.entries()) {
    const [x, y] = bobPosition(length, angle);
    const opacity = count === 0 ? 0 : (index + 1) / count;
    v.circle(x, y, 6, { fill: `rgba(38, 132, 146, ${Math.round(opacity * 22) / 100})` });
  }
}

function drawPeriodLabel(v: View, length: number): void {
  // Keep the measured text and its backing in the same coordinate space.
  const precise = `Period  ${(2 * Math.PI * Math.sqrt(length / G)).toFixed(2)} s`;
  const options = { size: 18, font: "Arial, sans-serif", style: "bold" as const,
    fill: "#183e50", valign: "middle" as const };
  const bounds = v.textBounds(precise, { x: 29, y: 56 }, options);
  const padX = 15;
  const padY = 11;
  v.roundRect(bounds.x - padX, bounds.y - padY,
    bounds.w + padX * 2, bounds.h + padY * 2, 8, {
      fill: "#eef8f8", stroke: "#a6c6ca", weight: 1.5,
    });
  v.text(precise, { x: 29, y: 56 }, options);
}

function drawArcGuide(v: View, length: number): void {
  const radius = length * PX_PER_METER;
  v.arc(CX, CY, radius, Math.PI / 2 - 0.54, Math.PI / 2 + 0.54, {
    stroke: "#cad9df", weight: 1, dash: [4, 5],
  });
  for (let step = -4; step <= 4; step += 1) {
    const angle = step * 0.12;
    const [x1, y1] = bobPosition(length, angle);
    const [x2, y2] = bobPosition(length + 0.045, angle);
    v.line(x1, y1, x2, y2, { stroke: "#b3c7d0", weight: 1 });
  }
}

export function draw(v: View, model: Model): void {
  v.background("#fcfdfd");
  v.rect(0, 0, v.width, 88, { fill: "#f0f7f8" });
  v.text("PENDULUM", { x: 29, y: 23 }, { size: 11, style: "bold", fill: "#5e7c8c" });
  v.line(30, 89, v.width - 30, 89, { stroke: "#d5e5e9", weight: 1 });

  const length = Math.max(0.5, Math.min(2.5, model.length));
  drawPeriodLabel(v, length);
  drawArcGuide(v, length);
  drawTrail(v, { angles: model.pastAngles, length });

  const period = 2 * Math.PI * Math.sqrt(length / G);
  const elapsed = model.frame / 60;
  const angle = 0.43 * Math.cos(2 * Math.PI * elapsed / period);
  const [bobX, bobY] = bobPosition(length, angle);
  v.line(CX, CY, bobX, bobY, { stroke: "#49697a", weight: 2.4, cap: "round" });
  v.circle(CX, CY, 6, { fill: "#264b61" });
  v.circle(bobX, bobY, 16, { fill: "#147c88", stroke: "#0c5f70", weight: 2 });
  v.circle(bobX - 5, bobY - 6, 3.5, { fill: "#b7eaeb" });
  v.text("pivot", { x: CX + 13, y: CY - 8 }, { size: 12, fill: "#607b89" });
  drawScale(v, length);

  v.text("Drag to change the string length", { x: 30, y: 374 }, {
    size: 12, fill: "#50647c",
  });
  v.control("length", { x: 30, y: 396, w: 390, h: 30 });
  v.text(`${length.toFixed(2)} m`, { x: 433, y: 410 }, {
    size: 13, fill: "#174858", valign: "middle", style: "bold",
  });
}

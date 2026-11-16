// A 640×600 sheet of plain shapes for the parity test: fills, strokes with
// caps, joins and dashes, arcs, curves, gradients, and shapes under rotation,
// non-uniform scale, skew and a full matrix. The Skia painter's render of the
// same cells is frozen in test/fixtures/scene-parity/shapes.png.
import type { PathCommand, Vec2 } from "../../src/core/paint.js";
import type { View as DraftView } from "../../src/core/tea.js";
import { matrixOf, mul } from "../../src/scene/mat.js";
import type { Mat } from "../../src/scene/nodes.js";

type Common = Pick<DraftView, "rect" | "roundRect" | "circle" | "ellipse" | "arc" | "polygon" | "path" | "curve" | "line" | "linearGradient" | "radialGradient" | "ellipseGradient">;
interface Pen {
  readonly cap?: "butt" | "round" | "square";
  readonly join?: "miter" | "round" | "bevel";
}
interface Cell {
  readonly name: string;
  readonly pen?: Pen;
  readonly matrix?: Mat;
  readonly body: (v: Common, pen: Pen) => void;
}

const zigzag: Vec2[] = [[15, 95], [45, 25], [75, 95], [105, 25], [140, 90]];
const sharp: PathCommand[] = [["move", 20, 100], ["line", 80, 20], ["line", 95, 100], ["line", 110, 30], ["line", 140, 34]];
const pentagram: Vec2[] = Array.from({ length: 5 }, (_, i): Vec2 => [80 + 50 * Math.cos(-Math.PI / 2 + (i * 4 * Math.PI) / 5), 62 + 50 * Math.sin(-Math.PI / 2 + (i * 4 * Math.PI) / 5)]);
const loop: Vec2[] = [[20, 30], [140, 95], [140, 30], [20, 95]];

const CELLS: readonly Cell[] = [
  { name: "rect-stroke", body: (v) => v.rect(22, 22, 116, 76, { fill: "#2a9d8f", stroke: "#264653", weight: 8 }) },
  { name: "round-rect", body: (v) => v.roundRect(15, 15, 130, 90, 22, { fill: "#f4a261", stroke: "#000000", weight: 3 }) },
  { name: "circles", body: (v) => {
    v.circle(48, 60, 35, { fill: "#e63946" });
    v.circle(115, 60, 32, { stroke: "#1d3557", weight: 1 });
    v.circle(115, 60, 14, { stroke: "#1d3557", weight: 2.5 });
  } },
  { name: "ellipse-gradient", body: (v) => v.ellipse(80, 60, 70, 40, { fill: v.ellipseGradient(80, 60, 70, 40, [[0, "#ffd166"], [1, "#8338ec"]]) }) },
  { name: "arc", body: (v) => v.arc(80, 60, 45, 0.3, 4, { fill: "rgba(42,157,143,0.6)", stroke: "#000000", weight: 4 }) },
  { name: "pentagram", body: (v) => v.polygon(pentagram, { fill: "#3a86ff", stroke: "#03045e", weight: 2 }) },
  { name: "curve-closed", body: (v) => v.curve(loop, true, { fill: "#ff006e", stroke: "#000000", weight: 2 }) },
  { name: "miter-sharp", body: (v, pen) => v.path(sharp, { stroke: "#6d597a", weight: 10, ...pen }) },
  { name: "cap-round", pen: { cap: "round" }, body: (v, pen) => {
    v.line(25, 30, 135, 30, { stroke: "#e76f51", weight: 16, ...pen });
    v.line(25, 85, 135, 70, { stroke: "#264653", weight: 9, ...pen });
  } },
  { name: "cap-square", pen: { cap: "square" }, body: (v, pen) => {
    v.line(25, 30, 135, 30, { stroke: "#e76f51", weight: 16, ...pen });
    v.line(25, 85, 135, 70, { stroke: "#264653", weight: 9, ...pen });
  } },
  { name: "join-round", pen: { join: "round" }, body: (v, pen) => v.polygon(zigzag.slice(0, 4), { stroke: "#2a9d8f", weight: 12, ...pen }) },
  { name: "join-bevel", pen: { join: "bevel" }, body: (v, pen) => v.path(zigzag.map(([x, y], i): PathCommand => [i === 0 ? "move" : "line", x, y]), { stroke: "#9b2226", weight: 12, ...pen }) },
  { name: "gradient-stroke", body: (v) => v.curve(zigzag, false, { stroke: v.linearGradient(15, 0, 140, 0, [[0, "#3a86ff"], [0.5, "rgba(255,0,110,0.5)"], [1, "#ffbe0b"]]), weight: 10 }) },
  { name: "radial", body: (v) => v.rect(10, 10, 140, 100, { fill: v.radialGradient(70, 55, 60, [[0, "#ffffff"], [0.4, "#ffd166"], [1, "rgba(6,214,160,0.2)"]]) }) },
  { name: "rotate-scale", matrix: matrixOf({ translate: [80, 60], rotate: 0.4, scale: [1.6, 0.6] }), body: (v) => {
    v.rect(-35, -40, 70, 80, { fill: "#90e0ef", stroke: "#03045e", weight: 6 });
    v.circle(0, 0, 18, { stroke: "#d00000", weight: 4 });
  } },
  { name: "skew-matrix", matrix: mul([0.9, 0.15, -0.2, 1.1, 10, 4], matrixOf({ skew: [0.5, 0.1] })), body: (v) => {
    v.rect(20, 20, 80, 70, { fill: "#cdb4db", stroke: "#3c096c", weight: 5 });
    v.curve(loop, false, { stroke: "rgba(0,0,0,0.5)", weight: 6 });
  } },
  // Dashes (drawing-round finding 1): Canvas2D's setLineDash, so today's renderer is the reference.
  { name: "dash-open", body: (v) => {
    v.line(20, 25, 140, 25, { stroke: "#264653", weight: 6, dash: [12, 6] });
    v.curve(zigzag, false, { stroke: "#9b2226", weight: 3, dash: [10, 4, 2] });
  } },
  { name: "dash-dots", pen: { cap: "round", join: "round" }, body: (v, pen) => {
    v.line(20, 30, 140, 30, { stroke: "#e76f51", weight: 8, dash: [0, 14], ...pen });
    v.path(sharp, { stroke: "#2a9d8f", weight: 5, dash: [18, 7], ...pen });
  } },
  { name: "dash-closed", body: (v) => {
    v.rect(20, 18, 80, 50, { fill: "#cdb4db", stroke: "#3c096c", weight: 5, dash: [16, 8] });
    v.circle(115, 78, 30, { stroke: "#1d3557", weight: 3, dash: [9, 5] });
    // A dash over the whole loop, and one that wraps through the start corner: both mitered there.
    v.rect(108, 8, 20, 20, { stroke: "#9b2226", weight: 5, dash: [150, 10] });
    v.rect(135, 8, 20, 20, { stroke: "#9b2226", weight: 5, dash: [64, 6] });
  } },
  { name: "dash-scaled", matrix: matrixOf({ translate: [10, 20], scale: [2, 0.8] }), body: (v) => {
    v.line(5, 20, 65, 20, { stroke: "#6d597a", weight: 6, dash: [8, 4] });
    v.rect(10, 50, 50, 50, { stroke: "#000000", weight: 4, dash: [6, 3] });
  } },
];

/** Each cell's rectangle on the sheet, 4 across. */
export const SHAPE_CELLS = CELLS.map((c, i) => ({ name: c.name, rect: [(i % 4) * 160, Math.floor(i / 4) * 120, 160, 120] as const }));

const origin = (i: number): Mat => [1, 0, 0, 1, (i % 4) * 160, Math.floor(i / 4) * 120];

export function drawShapesDraft(v: DraftView): void {
  v.background("#fdfcf8");
  for (const [i, c] of CELLS.entries()) v.at({ matrix: mul(origin(i), c.matrix ?? [1, 0, 0, 1, 0, 0]) }, () => c.body(v, c.pen ?? {}));
}

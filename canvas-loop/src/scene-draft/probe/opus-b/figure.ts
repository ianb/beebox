// A pendulum, as an educational figure: a slider for the length placed over
// the canvas, the period in a label box sized to its text, a faint trail of
// past bob positions, and a tick scale along the string. Clean, not painterly.
// Scene API draft 2.1 probe (opus-b).
import type { DeepReadonly, ParamsDecl, ParamValues, TextOptions } from "../../../core/tea.js";
import type { Style, Vec2, View } from "../../scene-api.js";

export const params = {
  length: { type: "number", min: 0.5, max: 2.5, step: 0.1, default: 1.2, label: "Length (m)", panel: false },
} as const satisfies ParamsDecl;

export const canvas = { width: 520, height: 380 };

export interface Model {
  frame: number;
  /** Swing angle now, radians from straight down. */
  angle: number;
  /** Recent bob positions in metres from the pivot, oldest first. */
  trail: readonly Vec2[];
}

const G = 9.81;
/** Pixels per metre. */
const PX = 120;
const PIVOT: Vec2 = [260, 60];

const INK = "#1f2937";
const MUTED = "#64748b";
const ACCENT = "#2563eb";
const ROD: Style = { stroke: INK, weight: 2, cap: "round" };
const TICK: Style = { stroke: MUTED, weight: 1, cap: "butt" };
const LABEL: TextOptions = { size: 15, fill: INK, font: "system-ui, sans-serif" };
const SMALL: TextOptions = { size: 11, fill: MUTED, font: "system-ui, sans-serif" };

export function period(length: number): number {
  return 2 * Math.PI * Math.sqrt(length / G);
}

/** A label in a rounded box that fits it, anchored by its top-left corner. */
function boxedLabel(v: View, args: { text: string; x: number; y: number }): void {
  const pad = 8;
  const b = v.textBounds(args.text, { x: args.x + pad, y: args.y + pad }, LABEL);
  v.group({ effects: { shadow: { x: 0, y: 2, blur: 4, color: "rgba(15,23,42,0.18)" } } }, () => {
    v.roundRect(args.x, args.y, b.w + 2 * pad, b.h + 2 * pad, 6, { fill: "#ffffff", stroke: "#cbd5e1", weight: 1 });
  });
  v.text(args.text, { x: args.x + pad, y: args.y + pad }, LABEL);
}

/** Tick marks along the string, every 10 cm, labelled every 50 cm. */
function scale(v: View, args: { length: number; angle: number }): void {
  v.at({ translate: PIVOT, rotate: args.angle }, () => {
    for (let cm = 10; cm <= args.length * 100 + 0.01; cm += 10) {
      const y = (cm / 100) * PX;
      const major = cm % 50 === 0;
      v.line(-(major ? 8 : 4), y, 0, y, TICK);
      if (major) {
        // keep the numbers upright as the scale swings
        v.at({ translate: [-12, y], rotate: -args.angle }, () => {
          v.text(`${(cm / 100).toFixed(1)}`, { x: 0, y: 0 }, { ...SMALL, align: "right", valign: "middle", halo: "#f8fafc" });
        });
      }
    }
  });
}

function trail(v: View, points: readonly Vec2[]): void {
  const n = points.length;
  v.group({ name: "trail", opacity: 0.5 }, () => {
    for (const [i, [mx, my]] of points.entries()) {
      const age = (i + 1) / n;
      v.circle(PIVOT[0] + mx * PX, PIVOT[1] + my * PX, 2 + 3 * age, { fill: `rgba(37,99,235,${(0.08 + 0.4 * age).toFixed(3)})` });
    }
  });
}

// eslint-disable-next-line max-params -- TEA contract signature
export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): void {
  const length = p.length;
  const angle = model.angle;
  const bob: Vec2 = [PIVOT[0] + Math.sin(angle) * length * PX, PIVOT[1] + Math.cos(angle) * length * PX];

  v.background("#f8fafc");
  // ceiling bar and the rest line
  v.rect(PIVOT[0] - 70, PIVOT[1] - 10, 140, 10, { fill: "#cbd5e1" });
  v.line(PIVOT[0], PIVOT[1], PIVOT[0], PIVOT[1] + length * PX + 30, { stroke: "#cbd5e1", weight: 1, dash: [4, 4] });
  // the swing's arc, at its full amplitude so far
  const amp = model.trail.reduce((m, [x, y]) => Math.max(m, Math.abs(Math.atan2(x, y))), Math.abs(angle));
  v.arc(PIVOT[0], PIVOT[1], length * PX, Math.PI / 2 - amp, Math.PI / 2 + amp, { stroke: "#e2e8f0", weight: 1 });

  trail(v, model.trail);
  v.line(PIVOT[0], PIVOT[1], bob[0], bob[1], ROD);
  scale(v, { length, angle });
  v.circle(PIVOT[0], PIVOT[1], 4, { fill: INK });
  v.circle(bob[0], bob[1], 14, { fill: ACCENT, stroke: INK, weight: 1.5 });

  boxedLabel(v, { text: `Period T = ${period(length).toFixed(2)} s`, x: 16, y: 16 });
  v.text("T = 2π √(L / g)", { x: 16, y: 62 }, SMALL);

  v.text("Length", { x: 16, y: v.height - 44 }, { ...SMALL, valign: "bottom" });
  v.control("length", { x: 16, y: v.height - 40, w: 200 });
  v.text(`${length.toFixed(1)} m`, { x: 224, y: v.height - 30 }, { ...LABEL, valign: "middle" });
}

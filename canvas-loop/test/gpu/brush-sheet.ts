// A 640×480 sheet of brushed strokes for parity: one row per preset (ink,
// marker, pencil, chalk, airbrush, wash, bristle), three strokes at different
// widths and pressures, and two crossing strokes over a tinted strip. Drawn
// with the same calls through today's View and the draft's, so the crops can
// be compared by mean luminance and contrast (parity-criteria.md section 2).
import type { BrushName } from "../../src/core/brush/presets.js";
import type { EnvelopePreset } from "../../src/core/brush/types.js";
import type { Drawing, DrawingNode, Vec2 } from "../../src/core/paint.js";

/** The calls the sheet uses, as both Views have them. */
export interface SheetView {
  background(paint: string): DrawingNode;
  rect(...args: [number, number, number, number, { fill: string }]): DrawingNode;
  curve(...args: [readonly Vec2[], boolean, { stroke: string; weight: number; brush: BrushName; gesture: { pressure: EnvelopePreset; wobble: number } }]): DrawingNode;
}

const ROWS: readonly { brush: BrushName; weight: number; colors: readonly [string, string, string] }[] = [
  { brush: "ink", weight: 4, colors: ["#1d2a44", "#7a2f1d", "#1d2a44"] },
  { brush: "marker", weight: 12, colors: ["#d0453a", "#2f7bbf", "#e0b02a"] },
  { brush: "pencil", weight: 3, colors: ["#2b2b2b", "#2b2b2b", "#3a4a8a"] },
  { brush: "chalk", weight: 10, colors: ["#3b5d8a", "#b0563a", "#2f6b3a"] },
  { brush: "airbrush", weight: 18, colors: ["#c04a7a", "#3a6ab0", "#e09a2a"] },
  { brush: "wash", weight: 18, colors: ["#3b4a8a", "#6a7d4a", "#8a3b5a"] },
  { brush: "bristle", weight: 14, colors: ["#1d2a44", "#b0563a", "#2f6b3a"] },
];
const PRESSURES: readonly EnvelopePreset[] = ["taper", "even", "swell"];
const WIDTHS = [0.6, 1, 1.4];
const ROW = 64;

/** Each crop: the preset's three strokes, then its crossing pair. */
export const SHEET_CROPS: readonly { name: string; rect: readonly [number, number, number, number] }[] = ROWS.flatMap((row, r) => [
  { name: `${row.brush} strokes`, rect: [0, 16 + r * ROW, 488, ROW] as const },
  { name: `${row.brush} crossing`, rect: [488, 16 + r * ROW, 152, ROW] as const },
]);

export function drawSheet(v: SheetView): Drawing {
  const out: Drawing[] = [];
  out.push(v.background("#f4efe2"));
  for (const [r, row] of ROWS.entries()) {
    const cy = 16 + r * ROW + ROW / 2;
    out.push(v.rect(492, cy - 28, 144, 56, { fill: "#cfe0ea" }));
    for (let i = 0; i < 3; i++) {
      const x0 = 14 + i * 160;
      const points: Vec2[] = [[x0, cy + 12], [x0 + 50, cy - 14], [x0 + 100, cy + 12], [x0 + 148, cy - 8]];
      out.push(v.curve(points, false, { stroke: row.colors[i] ?? "#000", weight: row.weight * (WIDTHS[i] ?? 1), brush: row.brush, gesture: { pressure: PRESSURES[i] ?? "even", wobble: 1 } }));
    }
    out.push(v.curve([[500, cy - 22], [560, cy], [628, cy + 22]], false, { stroke: row.colors[1], weight: row.weight, brush: row.brush, gesture: { pressure: "taper", wobble: 0 } }));
    out.push(v.curve([[500, cy + 22], [566, cy + 3], [628, cy - 22]], false, { stroke: row.colors[2], weight: row.weight, brush: row.brush, gesture: { pressure: "taper", wobble: 0 } }));
  }
  return out;
}

/** Coloured stripes and two ink lines, then a smudge and a wet stroke across them (320×160). */
export function drawSmear(v: SheetView): Drawing {
  const out: Drawing[] = [];
  out.push(v.background("#f4efe2"));
  const colors = ["#d0453a", "#e0b02a", "#2f7bbf", "#2f6b3a", "#6a3b7a", "#f4efe2"];
  for (let i = 0; i < 12; i++) out.push(v.rect(10 + i * 25, 10, 13, 140, { fill: colors[i % colors.length] ?? "#000" }));
  out.push(v.curve([[15, 40], [150, 28], [305, 48]], false, { stroke: "#1d2a44", weight: 4, brush: "ink", gesture: { pressure: "even", wobble: 0 } }));
  out.push(v.curve([[15, 120], [150, 132], [305, 112]], false, { stroke: "#1d2a44", weight: 4, brush: "ink", gesture: { pressure: "even", wobble: 0 } }));
  out.push(v.curve([[15, 58], [110, 44], [210, 70], [312, 52]], false, { stroke: "#000000", weight: 18, brush: "smudge", gesture: { pressure: "even", wobble: 0 } }));
  out.push(v.curve([[15, 100], [120, 118], [215, 92], [312, 106]], false, { stroke: "#f2f2f2", weight: 18, brush: "wet", gesture: { pressure: "even", wobble: 0 } }));
  return out;
}

export const SMEAR_CROPS: readonly { name: string; rect: readonly [number, number, number, number] }[] = [
  { name: "smudge left", rect: [0, 30, 160, 50] },
  { name: "smudge right", rect: [160, 30, 160, 50] },
  { name: "wet left", rect: [0, 80, 160, 50] },
  { name: "wet right", rect: [160, 80, 160, 50] },
];

/** Mean luminance and its standard deviation inside `rect` (premultiplied over an opaque ground). */
export function lumStats(d: Uint8Array, at: { width: number; rect: readonly [number, number, number, number] }): { mean: number; sd: number } {
  const [rx, ry, rw, rh] = at.rect;
  const v: number[] = [];
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      const i = (y * at.width + x) * 4;
      v.push(0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0));
    }
  }
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return { mean, sd };
}

/** The brush parity row for one crop: luminance and contrast differences in percent of the reference. */
export function cropParity(images: { ref: Uint8Array; gpu: Uint8Array }, at: { width: number; name: string; rect: readonly [number, number, number, number] }): { name: string; lum: number; contrast: number; pass: boolean } {
  const a = lumStats(images.ref, at);
  const b = lumStats(images.gpu, at);
  const lum = (100 * Math.abs(a.mean - b.mean)) / Math.max(1, a.mean);
  const contrast = (100 * Math.abs(a.sd - b.sd)) / Math.max(1, a.sd);
  return { name: at.name, lum: Math.round(lum * 100) / 100, contrast: Math.round(contrast * 100) / 100, pass: lum <= 3 && contrast <= 15 };
}

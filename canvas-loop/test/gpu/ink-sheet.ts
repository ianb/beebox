// Thin ink lines for mark-atlas.ink.gpu.test.ts
// (canvas-loop-gpu-brushes.subplan.md, chunk 4): one row per width and
// pressure, each a straight line, a diagonal and a curve, at widths 0.6 and
// 1.0 px (ratio 1). Drawn through today's View to freeze the Skia reference
// (test/fixtures/scene-parity/ink-thin.png) and through the draft's for the
// GPU render; a row's tone is compared by its mean.
import type { SheetView } from "./brush-sheet.js";

export const THIN_SIZE = { width: 320, height: 96 } as const;
const ROW = 24;
const PAPER = "#f4efe2";
const LINES = [[0.6, "even"], [1, "even"], [0.6, "taper"], [1, "taper"]] as const;

/** Each row's band and what it holds. */
export const THIN_ROWS: readonly { name: string; y: number; h: number }[] = LINES.map(([w, p], r) => ({ name: `width ${w}, ${p}`, y: r * ROW, h: ROW }));

export function drawThin(v: SheetView): void {
  v.background(PAPER);
  for (const [r, [weight, pressure]] of LINES.entries()) {
    const cy = r * ROW + ROW / 2;
    const style = { stroke: "#1d2a44", weight, brush: "ink", gesture: { pressure, wobble: 0 } } as const;
    v.curve([[10, cy + 0.25], [100, cy + 0.25]], false, style);
    v.curve([[110, cy - 8], [200, cy + 7]], false, style);
    v.curve([[210, cy + 6], [250, cy - 8], [310, cy + 5]], false, style);
  }
}

/** A row's tone: the mean darkening below the paper's luminance, over its band (premultiplied over an opaque ground). */
export function rowTone(d: Uint8Array, row: { y: number; h: number }): number {
  const paper = 0.2126 * 0xf4 + 0.7152 * 0xef + 0.0722 * 0xe2;
  let sum = 0;
  for (let y = row.y; y < row.y + row.h; y++) {
    for (let x = 0; x < THIN_SIZE.width; x++) {
      const i = (y * THIN_SIZE.width + x) * 4;
      sum += paper - (0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0));
    }
  }
  return sum / (row.h * THIN_SIZE.width);
}

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

const G = (f: number): number => (f <= 0 ? 0 : f >= 1 ? f - 0.5 : 0.5 * f * f);

/**
 * Closed rings (device px) filled by exact area, nonzero, row by row over the
 * thin sheet: per edge, the signed area right of it in each pixel, summed,
 * then `min(|sum|, 1)` (the GPU renderer's coverage pieces, which drew ink
 * before chunk 4; scratch/stage5/brushes/gate/raster.ts in f64).
 */
export function areaCoverage(rings: readonly (readonly number[])[]): Float64Array {
  const { width: W, height: H } = THIN_SIZE;
  const acc = new Float64Array(W * H);
  for (const r of rings) {
    const n = r.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      let [ax, ay, bx, by] = [r[2 * i] ?? 0, r[2 * i + 1] ?? 0, r[2 * j] ?? 0, r[2 * j + 1] ?? 0];
      let sign = 1;
      if (ay === by) continue;
      if (ay > by) [ax, ay, bx, by, sign] = [bx, by, ax, ay, -1];
      const dxdy = (bx - ax) / (by - ay);
      for (let py = Math.max(Math.floor(ay), 0); py < Math.min(Math.ceil(by), H); py++) {
        const ya = Math.max(py, ay);
        const yb = Math.min(py + 1, by);
        for (let px = Math.max(Math.floor(Math.min(ax, bx)), 0); px < W; px++) {
          const fa = px + 1 - (ax + (ya - ay) * dxdy);
          const fb = px + 1 - (ax + (yb - ay) * dxdy);
          let area = 0;
          if (Math.min(fa, fb) >= 1) area = yb - ya;
          else if (Math.max(fa, fb) <= 0) area = 0;
          else if (Math.abs(fb - fa) < 1e-3) area = Math.min(1, Math.max(0, 0.5 * (fa + fb))) * (yb - ya);
          else area = ((G(fb) - G(fa)) / (fb - fa)) * (yb - ya);
          acc[py * W + px] = (acc[py * W + px] ?? 0) + sign * area;
        }
      }
    }
  }
  return acc.map((v) => Math.min(Math.abs(v), 1));
}

/** A row's tone from coverages of the sheet's ink over its paper (as `rowTone`). */
export function coverageTone(cov: Float64Array, row: { y: number; h: number }): number {
  const L = (c: readonly number[]): number => 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
  const dark = L([0xf4, 0xef, 0xe2]) - L([0x1d, 0x2a, 0x44]);
  let sum = 0;
  for (let y = row.y; y < row.y + row.h; y++) for (let x = 0; x < THIN_SIZE.width; x++) sum += (cov[y * THIN_SIZE.width + x] ?? 0) * dark;
  return sum / (row.h * THIN_SIZE.width);
}

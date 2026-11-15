// A text line as glyph quads: each glyph's cell, rasterised at the line's
// device scale, mapped onto the device by the call's transform. Under a
// translation and uniform scale the pen snaps to a quarter pixel and the cell
// lands on whole device pixels, so the glyph is copied unresampled; under
// rotation or skew it is resampled bilinearly.
import type { Mat, TextLine, TextNode } from "../scene.js";
import type { GlyphCache } from "./glyphs.js";
import type { GlyphQuad, R } from "./jobs.js";
import { inter, isEmpty } from "./jobs.js";

function quarter(v: number): { whole: number; frac: number } {
  const q = Math.round((v - Math.floor(v)) * 4) / 4;
  return q >= 1 ? { whole: Math.floor(v) + 1, frac: 0 } : { whole: Math.floor(v), frac: q };
}

/** The quads for one line of `n`, its fill or its halo, under device transform `matrix`. */
export function lineQuads(n: TextNode, a: { line: TextLine; halo: boolean; matrix: Mat; glyphs: GlyphCache; visible: R }): GlyphQuad[] {
  const m = a.matrix;
  const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  if (!(s > 0) || !Number.isFinite(s)) return [];
  const tol = 1e-9 * s;
  const aligned = Math.abs(m[1]) <= tol && Math.abs(m[2]) <= tol && m[0] > 0 && Math.abs(m[0] - m[3]) <= tol;
  const font = `${n.style} ${Math.round(n.size * s * 64) / 64}px ${n.family}`;
  const halo = a.halo && n.halo !== undefined ? n.halo.width * s : 0;
  // Device → texels of the cell, relative to the pen: s · M⁻¹ (linear).
  const k = s / (m[0] * m[3] - m[1] * m[2]);
  const inv = [m[3] * k, -m[1] * k, -m[2] * k, m[0] * k] as const;
  const out: GlyphQuad[] = [];
  for (const [i, ch] of a.line.glyphs.entries()) {
    const x = a.line.xs[i] ?? 0;
    const y = a.line.y;
    let px = m[0] * x + m[2] * y + m[4];
    let py = m[1] * x + m[3] * y + m[5];
    let fx = 0;
    let fy = 0;
    if (aligned) {
      const qx = quarter(px);
      const qy = quarter(py);
      fx = qx.frac;
      fy = qy.frac;
      px = qx.whole + fx;
      py = qy.whole + fy;
    }
    const cell = a.glyphs.cell({ font, ch, baseline: n.baseline, halo, fx, fy });
    if (cell === undefined) continue;
    const t: [number, number] = [cell.ax - (inv[0] * px + inv[2] * py), cell.ay - (inv[1] * px + inv[3] * py)];
    // The cell's corners back on the device: pen + (M/s)·(texel − anchor).
    const corners = ([[0, 0], [cell.w, 0], [0, cell.h], [cell.w, cell.h]] as const).map(([u, v]) => {
      const du = u - cell.ax;
      const dv = v - cell.ay;
      return [px + (m[0] * du + m[2] * dv) / s, py + (m[1] * du + m[3] * dv) / s] as const;
    });
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const box = inter({ x0: Math.floor(Math.min(...xs)), y0: Math.floor(Math.min(...ys)), x1: Math.ceil(Math.max(...xs)), y1: Math.ceil(Math.max(...ys)) }, a.visible);
    if (!isEmpty(box)) out.push({ box, a: inv, t, cell });
  }
  return out;
}

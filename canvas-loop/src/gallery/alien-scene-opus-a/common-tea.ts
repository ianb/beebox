import type { Vec2 } from "@ianbicking/canvas-loop";

export type Pts = readonly Vec2[];

export const W = 800;
export const H = 600;

export const INK = "#1c2433";
export const ALIEN_LINE = "#1d3b33";
export const GREEN = "#7cc86a";
export const WARM = "#ffd27a";
/** The alien's centre line. */
export const AX = 330;

// ── geometry helpers ────────────────────────────────────────────────
export function ellipsePts(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  n = 12,
): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

/** A closed outline around a centreline, `w` wide, for limbs. */
export function tube(line: Pts, w0: number, w1: number): Vec2[] {
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const n = line.length;
  for (let i = 0; i < n; i += 1) {
    const p = line[i] ?? [0, 0];
    const a = line[Math.max(0, i - 1)] ?? p;
    const b = line[Math.min(n - 1, i + 1)] ?? p;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const w = (w0 + (w1 - w0) * (i / (n - 1))) / 2;
    left.push([p[0] + nx * w, p[1] + ny * w]);
    right.push([p[0] - nx * w, p[1] - ny * w]);
  }
  return [...left, ...right.reverse()];
}

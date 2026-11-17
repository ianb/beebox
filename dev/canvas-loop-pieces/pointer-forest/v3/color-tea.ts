// The palette as OKLCH triples, written out as CSS `oklch()` (canvas-loop
// parses it). Mixing between two palette colours is done here, in OKLab,
// where a straight line keeps the hue from swinging through grey.

/** Lightness 0..1, chroma 0..~0.37, hue in degrees. */
export type Lch = readonly [number, number, number];

/** A CSS colour for an OKLCH triple, with optional alpha. */
export function ok(c: Lch, alpha = 1): string {
  const [L, C, h] = c;
  const a = alpha >= 1 ? "" : ` / ${alpha.toFixed(3)}`;
  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${h.toFixed(1)}${a})`;
}

/** `t` of the way from `a` to `b`, in OKLab. */
export function toward(a: Lch, b: Lch, t: number): Lch {
  const ar = (a[2] * Math.PI) / 180;
  const br = (b[2] * Math.PI) / 180;
  const L = a[0] + (b[0] - a[0]) * t;
  const x = a[1] * Math.cos(ar) + (b[1] * Math.cos(br) - a[1] * Math.cos(ar)) * t;
  const y = a[1] * Math.sin(ar) + (b[1] * Math.sin(br) - a[1] * Math.sin(ar)) * t;
  return [L, Math.hypot(x, y), ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360];
}

/** Shift lightness, chroma and hue. */
export function shift(c: Lch, dL: number, dC = 0, dh = 0): Lch {
  return [Math.min(1, Math.max(0, c[0] + dL)), Math.max(0, c[1] + dC), (c[2] + dh + 360) % 360];
}

/** Small seeded generator for module-constant scatter. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash-based randomness for marks. Every random feature of a mark is a pure
// function of (mark seed, channel, index), so it never depends on what was drawn
// before (insertion stability), and a feature read by arc length stays put when
// a later part of the mark is edited.

/** 32-bit integer mix (lowbias32). */
function mix(input: number): number {
  let x = input >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** A float in [0, 1) for `(seed, channel, index)`. */
export function rand(seed: number, at: { channel: number; index: number }): number {
  return mix(seed ^ mix(at.channel * 0x9e3779b1 + mix(at.index))) / 4294967296;
}

/** Smooth 1-D value noise in [-1, 1] at position `x` (lattice spacing 1). */
export function noise1(seed: number, at: { channel: number; x: number }): number {
  const i = Math.floor(at.x);
  const f = at.x - i;
  const a = rand(seed, { channel: at.channel, index: i });
  const b = rand(seed, { channel: at.channel, index: i + 1 });
  const s = f * f * (3 - 2 * f);
  return (a + (b - a) * s) * 2 - 1;
}

/** FNV-1a over a string, as an unsigned 32-bit seed. */
export function hashString(text: string, basis: number): number {
  let h = basis >>> 0 || 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.codePointAt(i) ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Hash numbers (rounded to 1/1000) into a seed, continuing from `basis`. */
export function hashNumbers(values: readonly number[], basis: number): number {
  let h = basis >>> 0 || 0x811c9dc5;
  for (const v of values) {
    const q = Math.round(v * 1000) | 0;
    h = Math.imul(h ^ q, 0x01000193) >>> 0;
    h = mix(h);
  }
  return h >>> 0;
}

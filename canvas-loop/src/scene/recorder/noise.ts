// `v.noise(x, y?, z?)` (draft 2.3 section 15): seeded value noise of
// coordinates in 0..1, as p5 `noise` (four octaves, each half as strong).
// Lattice values come from the 32-bit integer hash the brushes use
// (core/brush/random.ts), so a run gives the same numbers in Node and in any
// browser; the seed is the run's.
import { SketchUsageError } from "../../core/errors.js";
import { rand } from "../../core/brush/random.js";

const OCTAVES = 4;
/** The sum of the octave weights (1/2 + 1/4 + 1/8 + 1/16), so the result stays below 1. */
const WEIGHTS = 1 - 0.5 ** OCTAVES;

const smooth = (f: number): number => f * f * (3 - 2 * f);

function lattice(seed: number, at: { octave: number; x: number; y: number; z: number }): number {
  const index = Math.imul(at.x, 73856093) ^ Math.imul(at.y, 19349663) ^ Math.imul(at.z, 83492791);
  return rand(seed, { channel: 0x6e01 + at.octave, index });
}

function octave(seed: number, at: { octave: number; x: number; y: number; z: number }): number {
  const ix = Math.floor(at.x);
  const iy = Math.floor(at.y);
  const iz = Math.floor(at.z);
  const sx = smooth(at.x - ix);
  const sy = smooth(at.y - iy);
  const sz = smooth(at.z - iz);
  const corner = (...[dx, dy, dz]: [number, number, number]): number => lattice(seed, { octave: at.octave, x: ix + dx, y: iy + dy, z: iz + dz });
  const lerp = (...[a, b, t]: [number, number, number]): number => a + (b - a) * t;
  const plane = (dz: number): number => lerp(lerp(corner(0, 0, dz), corner(1, 0, dz), sx), lerp(corner(0, 1, dz), corner(1, 1, dz), sx), sy);
  return lerp(plane(0), plane(1), sz);
}

/** Smooth value noise at (x, y, z) in [0, 1), lattice spacing 1 at the first octave. */
export function valueNoise(seed: number, at: { x: number; y: number; z: number }): number {
  for (const v of [at.x, at.y, at.z]) if (!Number.isFinite(v)) throw new SketchUsageError({ detail: `noise takes finite numbers, got ${String(v)}` });
  let sum = 0;
  let weight = 0.5;
  let scale = 1;
  for (let k = 0; k < OCTAVES; k++) {
    sum += weight * octave(seed >>> 0, { octave: k, x: at.x * scale, y: at.y * scale, z: at.z * scale });
    weight /= 2;
    scale *= 2;
  }
  return sum / WEIGHTS;
}

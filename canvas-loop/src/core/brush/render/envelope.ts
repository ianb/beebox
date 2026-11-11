// Pressure envelopes: a value over a mark's length, t in 0..1.
import { SketchUsageError } from "../../errors.js";
import type { Envelope, EnvelopePreset } from "../types.js";

const PRESETS: Record<EnvelopePreset, (t: number) => number> = {
  even: () => 1,
  taper: (t) => Math.min(ease(t / 0.25), ease((1 - t) / 0.3)),
  "taper-in": (t) => ease(t / 0.3),
  "taper-out": (t) => ease((1 - t) / 0.35),
  swell: (t) => 0.35 + 0.65 * Math.sin(Math.PI * t),
  press: (t) => 1 - 0.55 * t,
};

const PRESET_NAMES = Object.keys(PRESETS).join(", ");

/** Ease-out from the floor up to 1 over 0..1, so a taper never quite vanishes. */
function ease(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return 0.06 + 0.94 * (1 - (1 - c) * (1 - c));
}

function isPreset(name: string): name is EnvelopePreset {
  return Object.hasOwn(PRESETS, name);
}

/** Check an envelope once, before a mark samples it; raises a readable error. */
export function validateEnvelope(env: Envelope, field: string): void {
  if (typeof env === "number") {
    if (!Number.isFinite(env)) throw new SketchUsageError({ detail: `${field} must be a finite number` });
    return;
  }
  if (typeof env === "string") {
    if (!isPreset(env)) throw new SketchUsageError({ detail: `${field} "${env}" is not one of: ${PRESET_NAMES}` });
    return;
  }
  if (env.length === 0) throw new SketchUsageError({ detail: `${field} keyframes are empty` });
  let previous = -Infinity;
  for (const [t, v] of env) {
    if (!Number.isFinite(t) || !Number.isFinite(v)) throw new SketchUsageError({ detail: `${field} keyframes must be finite numbers` });
    if (t < 0 || t > 1) throw new SketchUsageError({ detail: `${field} keyframe t=${t} is outside 0..1` });
    if (t < previous) throw new SketchUsageError({ detail: `${field} keyframes must be sorted by t` });
    previous = t;
  }
}

function keyframes(env: readonly (readonly [number, number])[], t: number): number {
  let before: readonly [number, number] | undefined;
  for (const frame of env) {
    if (frame[0] > t) {
      if (before === undefined) return frame[1];
      const span = frame[0] - before[0];
      const f = span <= 0 ? 1 : (t - before[0]) / span;
      const s = f * f * (3 - 2 * f);
      return before[1] + (frame[1] - before[1]) * s;
    }
    // A duplicate t keeps the last value: later frames overwrite `before`.
    before = frame;
  }
  return before?.[1] ?? 1;
}

/** The envelope's value at `t` (0..1), clamped to 0..1. */
export function evalEnvelope(env: Envelope, t: number): number {
  let v: number;
  if (typeof env === "number") v = env;
  else if (typeof env === "string") v = isPreset(env) ? PRESETS[env](t) : 1;
  else v = keyframes(env, t);
  return Math.min(1, Math.max(0, v));
}

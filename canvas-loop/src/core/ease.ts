// Easing and keyframes for animation: pure functions of a number, so a sketch
// computes a moving value from `model.frame` (or any 0..1 progress) in `draw`.
import { SketchUsageError } from "./errors.js";

/**
 * An easing curve's name. `in`/`out`/`in-out` are cubic; `out-back`
 * overshoots a little and settles; `step` holds the start value until the
 * span's end, then jumps.
 */
export type EaseName = "linear" | "in" | "out" | "in-out" | "out-back" | "step";

const EASES: Record<EaseName, (u: number) => number> = {
  linear: (u) => u,
  step: (u) => (u < 1 ? 0 : 1),
  in: (u) => u * u * u,
  out: (u) => 1 - (1 - u) ** 3,
  "in-out": (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2),
  "out-back": (u) => {
    const c = 1.70158;
    return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2;
  },
};

/** A keyframe value: a number, or a tuple of numbers (a point, a colour's channels). */
export type TweenValue = number | readonly number[];

/**
 * A keyframe: `[time, value]`, or `[time, value, ease]` to ease the span that
 * starts at this keyframe differently from the rest. Times are in whatever
 * unit you pass as `t` (frames, seconds, 0..1).
 */
export type Keyframe<V extends TweenValue> = readonly [number, V] | readonly [number, V, EaseName];

function easeFn(name: EaseName): (u: number) => number {
  if (!Object.hasOwn(EASES, name)) throw new SketchUsageError({ detail: `ease "${String(name)}" is not one of: ${Object.keys(EASES).join(", ")}` });
  return EASES[name];
}

/** `name`'s curve at `u`, with `u` clamped to 0..1. */
export function ease(name: EaseName, u: number): number {
  return easeFn(name)(Math.min(1, Math.max(0, u)));
}

function checkKeys(keys: readonly Keyframe<TweenValue>[]): void {
  if (keys.length === 0) throw new SketchUsageError({ detail: "tween: give at least one keyframe [time, value]" });
  const first = keys[0]?.[1];
  const len = typeof first === "number" ? -1 : (first?.length ?? -1);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const [time, value] = key ?? [Number.NaN, 0];
    if (key?.[2] !== undefined) easeFn(key[2]);
    if (!Number.isFinite(time)) throw new SketchUsageError({ detail: `tween: keyframe ${i} has no finite time` });
    if (i > 0 && time < (keys[i - 1]?.[0] ?? -Infinity)) throw new SketchUsageError({ detail: `tween: keyframe times must be in order (keyframe ${i} at ${time} comes before ${keys[i - 1]?.[0]})` });
    const vlen = typeof value === "number" ? -1 : value.length;
    if (vlen !== len) throw new SketchUsageError({ detail: `tween: keyframe ${i}'s value has a different shape from keyframe 0's` });
  }
}

/** Where `t` falls: the two keyframe indexes around it and the eased mix between them. */
function locate(keys: readonly Keyframe<TweenValue>[], args: { t: number; ease: EaseName | undefined }): { a: number; b: number; k: number } {
  checkKeys(keys);
  const fallback = args.ease ?? "linear";
  easeFn(fallback);
  const { t } = args;
  const last = keys.length - 1;
  if (t < (keys[0]?.[0] ?? 0)) return { a: 0, b: 0, k: 0 };
  // The last keyframe at or before `t`: at a time two keyframes share, the later one wins (a jump lands on time).
  let i = 0;
  while (i < last && (keys[i + 1]?.[0] ?? Infinity) <= t) i++;
  if (i === last) return { a: last, b: last, k: 0 };
  const t0 = keys[i]?.[0] ?? 0;
  const t1 = keys[i + 1]?.[0] ?? t0;
  return { a: i, b: i + 1, k: easeFn(keys[i]?.[2] ?? fallback)((t - t0) / (t1 - t0)) };
}

/**
 * A number at time `t` between keyframes sorted by time, eased within each
 * span: `tween([[0, 20], [30, 200]], frame, "out")`. Before the first keyframe
 * it holds the first value; after the last, the last.
 */
export function tween(...args: [readonly Keyframe<number>[], number, EaseName?]): number {
  const [keys, t, name] = args;
  const { a, b, k } = locate(keys, { t, ease: name });
  const va = keys[a]?.[1] ?? 0;
  const vb = keys[b]?.[1] ?? va;
  return va + (vb - va) * k;
}

/** `tween` for tuples of numbers (a point, a colour's channels), each keyframe the same length. */
export function tweenPoint(...args: [readonly Keyframe<readonly number[]>[], number, EaseName?]): number[] {
  const [keys, t, name] = args;
  const { a, b, k } = locate(keys, { t, ease: name });
  const va = keys[a]?.[1] ?? [];
  const vb = keys[b]?.[1] ?? va;
  return va.map((x, i) => x + ((vb[i] ?? x) - x) * k);
}

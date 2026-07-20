/**
 * A critically-damped, velocity-carrying, interruptible rAF spring for the
 * lightbox — the animation the user interrupts mid-flight (dismiss snap-back,
 * pan rubber-band return). One spring drives N independent scalar channels
 * (e.g. transform `x`/`y`/`scale`, or a single dismiss offset) toward their
 * targets, calling `onFrame` with the live values each frame.
 *
 * The step is the exact critically-damped analytic solution
 * `x(t) = (x0 + (v0 + ω·x0)·t)·e^(−ω·t)`, so there is never overshoot and the
 * carried release velocity is honored. `prefers-reduced-motion` collapses to an
 * immediate jump. Timing primitives are injected so the module has no ambient
 * globals baked in.
 */

/** Default angular frequency (rad/s) — snappy but not abrupt. */
export const SPRING_OMEGA = 22;
/** Settle thresholds: below both, snap to target and finish. */
const POSITION_EPSILON = 0.05;
const VELOCITY_EPSILON = 0.05;

export interface SpringChannel {
  from: number;
  to: number;
  /** Initial velocity in units/second (carried from the release gesture). */
  velocity: number;
}

export interface SpringHandle {
  cancel(): void;
}

interface SpringTiming {
  now: () => number;
  raf: (cb: (time: number) => void) => number;
  cancelRaf: (handle: number) => void;
}

function stepChannel(
  channel: { value: number; velocity: number; to: number },
  { omega, dt }: { omega: number; dt: number },
): void {
  const x0 = channel.value - channel.to;
  const c2 = channel.velocity + omega * x0;
  const e = Math.exp(-omega * dt);
  const posOffset = (x0 + c2 * dt) * e;
  channel.value = channel.to + posOffset;
  channel.velocity = (c2 - omega * (x0 + c2 * dt)) * e;
}

/**
 * Start a spring. Returns a handle whose `cancel()` stops it without a final
 * frame (the caller keeps whatever value the last frame wrote).
 */
export function animateSpring(options: {
  channels: readonly SpringChannel[];
  omega: number;
  reducedMotion: boolean;
  timing: SpringTiming;
  onFrame: (values: number[]) => void;
  onDone: () => void;
}): SpringHandle {
  const { channels, omega, reducedMotion, timing, onFrame, onDone } = options;
  const targets = channels.map((c) => c.to);

  if (reducedMotion) {
    onFrame(targets);
    onDone();
    return { cancel: () => {} };
  }

  const live = channels.map((c) => ({ value: c.from, velocity: c.velocity, to: c.to }));
  let last = timing.now();
  let rafHandle = 0;
  let cancelled = false;

  const tick = (time: number): void => {
    if (cancelled) return;
    const dt = Math.min(0.064, Math.max(0, (time - last) / 1000));
    last = time;
    let settled = true;
    for (const channel of live) {
      stepChannel(channel, { omega, dt });
      if (
        Math.abs(channel.value - channel.to) > POSITION_EPSILON ||
        Math.abs(channel.velocity) > VELOCITY_EPSILON
      ) {
        settled = false;
      }
    }
    if (settled) {
      onFrame(targets);
      onDone();
      return;
    }
    onFrame(live.map((c) => c.value));
    rafHandle = timing.raf(tick);
  };

  rafHandle = timing.raf(tick);
  return {
    cancel: () => {
      cancelled = true;
      timing.cancelRaf(rafHandle);
    },
  };
}

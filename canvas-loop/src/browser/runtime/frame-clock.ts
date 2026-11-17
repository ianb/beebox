// The browser runtime's step clock input: how much time an animation frame
// advances the fixed 1/60 s steps (engine.ts).

/** One step: the runtime folds a `tick` per 1/60 s. */
export const STEP_MS = 1000 / 60;
/** A frame interval this close to a whole number of steps is that number: a 60 Hz display's timestamps wander by a millisecond or two. */
const SNAP_MS = 2;
/** A longer gap (a background tab, a debugger) counts as one step. */
const MAX_DT_MS = 250;

/**
 * The time a frame advances. Within `SNAP_MS` of a whole number of steps it
 * is exactly that many: otherwise a 15.2 ms frame after a short remainder runs
 * no step (no draw) and the 18.2 ms frame after it runs two, a visible stutter
 * on a 60 Hz display. Other rates (120 Hz, 144 Hz) are not near a whole step
 * and keep their exact time.
 */
export function frameTime(dt: number): number {
  const whole = Math.round(dt / STEP_MS);
  return whole >= 1 && Math.abs(dt - whole * STEP_MS) <= SNAP_MS ? whole * STEP_MS : dt;
}

/** Frame intervals in, step-clock time out: snapped (`frameTime`), with what snapping took or gave added back once it reaches half a step, so a 55 Hz display still runs 60 steps a second. */
export class FrameClock {
  #drift = 0;

  advance(raw: number): number {
    if (raw > MAX_DT_MS) {
      this.#drift = 0;
      return STEP_MS;
    }
    let dt = frameTime(raw);
    this.#drift += raw - dt;
    if (Math.abs(this.#drift) >= STEP_MS / 2) {
      dt += this.#drift;
      this.#drift = 0;
    }
    return dt;
  }

  reset(): void {
    this.#drift = 0;
  }
}

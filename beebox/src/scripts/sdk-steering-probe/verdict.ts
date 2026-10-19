/**
 * Outcome classification for `run.ts`, kept free of SDK calls
 * so it can be tested. A timeout means the probe learned nothing; only a lost
 * or misrouted steer message means the steering behavior changed.
 */

export interface Observation {
  /** Number of `result` messages before the steer answer (0 = same turn). */
  turnsBeforeSteerAnswer: number | null;
  resultCount: number;
  timedOut: boolean;
}

export type Outcome =
  | { kind: "pass" }
  | { kind: "fail"; reason: string }
  | { kind: "inconclusive"; reason: string };

/** Probe exit statuses. The sdk-update monitor reads these. */
export const EXIT_PASS = 0;
export const EXIT_BEHAVIOR_CHANGED = 1;
export const EXIT_INCONCLUSIVE = 2;

export function classify(expectSameTurn: boolean, obs: Observation): Outcome {
  if (obs.turnsBeforeSteerAnswer === null) {
    return obs.timedOut
      ? { kind: "inconclusive", reason: "timed out before the steer answer arrived" }
      : { kind: "fail", reason: "steer message was LOST (never answered)" };
  }
  if (expectSameTurn && obs.turnsBeforeSteerAnswer !== 0) {
    return { kind: "fail", reason: `expected same-turn injection, but the answer came ${obs.turnsBeforeSteerAnswer} turn(s) later` };
  }
  return { kind: "pass" };
}

/** A behavior change outranks a timeout elsewhere in the run. */
export function exitStatus(outcomes: readonly Outcome[]): number {
  if (outcomes.some((o) => o.kind === "fail")) return EXIT_BEHAVIOR_CHANGED;
  if (outcomes.some((o) => o.kind === "inconclusive")) return EXIT_INCONCLUSIVE;
  return EXIT_PASS;
}

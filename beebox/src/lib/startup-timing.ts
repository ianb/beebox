/**
 * Startup phase timing for one process.
 *
 * `markStartupPhase` records how long after process start each phase ended
 * (`performance.now()` counts from process start in Node). `bbx serve`
 * marks its boot phases; the diag-key-gated `/healthz` reports them so a
 * slow cold start can be broken down without a log line on every boot.
 * See `docs/development/performance.md`.
 */

export interface StartupPhase {
  phase: string;
  /** Milliseconds from process start to the end of this phase. */
  atMs: number;
}

const phases: StartupPhase[] = [];

export function markStartupPhase(phase: string): void {
  phases.push({ phase, atMs: Math.round(performance.now()) });
}

export function startupPhases(): readonly StartupPhase[] {
  return phases;
}

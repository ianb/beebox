/**
 * Module-level bridge between the transcription pipeline's MicCapture
 * (which owns the mic stream and an AnalyserNode tap) and UI volume
 * indicators. The mic is a singleton device, so one mutable source slot
 * suffices — same pattern as the shared audio element in audio-context.ts.
 *
 * `getMicLevel()` returns 0 when no capture is live OR when audio stops
 * reaching a live capture (suspended AudioContext, revoked track), so a
 * flat indicator is an honest "the mic isn't hearing you" signal.
 */

let source: (() => number) | null = null;

export function setMicLevelSource(fn: () => number): void {
  source = fn;
}

/** Clear the slot, but only if `fn` still owns it — a disposed capture must
 *  not clobber the registration of the segment that replaced it. */
export function clearMicLevelSource(fn: () => number): void {
  if (source === fn) source = null;
}

/** Current mic input level in [0, 1]; 0 when nothing is capturing. */
export function getMicLevel(): number {
  return source ? source() : 0;
}

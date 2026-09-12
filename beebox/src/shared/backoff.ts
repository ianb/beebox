/**
 * Retry timing helpers shared by every recovery loop that needs bounded,
 * de-correlated retry delays. Originally the realtime transcription actor's
 * two recovery paths (initial connect-with-retry and the mid-recording
 * reconnect loop); moved to `shared/` (from `frontend/src/machines/`) so the
 * server's HQ job (`core/voice-recording/hq-job.ts`, a later chunk of
 * `docs/plans/resilient-voice-recording.md`) can reuse the same helper
 * instead of a second backoff idiom (#8).
 */

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Full-jitter exponential backoff: a random delay in [0, min(cap, base·2^n)].
 * `attempt` is 1-based (first retry = attempt 1). Full jitter (rather than
 * base±spread) is what AWS's canonical write-up found best de-correlates a
 * thundering herd.
 */
export function jitteredBackoff(attempt: number, { baseMs, capMs }: { baseMs: number; capMs: number }): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** (attempt - 1));
  return Math.round(Math.random() * ceiling);
}

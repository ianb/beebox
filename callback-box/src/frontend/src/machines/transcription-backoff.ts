/**
 * Retry timing helpers shared by the transcription actor's two recovery paths:
 * the initial connect-with-retry (a fresh socket that fails to open) and the
 * mid-recording reconnect loop. Deepgram's streaming guidance recommends
 * backoff with jitter so many clients don't re-storm the API in lockstep after
 * a shared outage; the actor's recovery windows are short (single-digit
 * seconds), so the caps here stay small rather than the 30s a long-lived
 * server reconnect would use.
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

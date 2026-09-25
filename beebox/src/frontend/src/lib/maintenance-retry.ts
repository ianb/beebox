/**
 * A box closed for maintenance answers 503 with `Retry-After` (seconds) when it
 * knows its drain deadline. The chat client waits that long and sends once
 * more, rather than failing a message the user just typed. Bounded: a wait
 * longer than the gate's own drain limit is not worth parking a message on.
 */

const MAX_WAIT_MS = 10 * 60_000;
const MIN_WAIT_MS = 1_000;

/** Milliseconds to wait before one retry, or null when the response gives no usable deadline. */
export function maintenanceRetryDelayMs(retryAfter: string | null): number | null {
  if (retryAfter === null) return null;
  const seconds = Number(retryAfter.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const ms = seconds * 1000;
  if (ms > MAX_WAIT_MS) return null;
  return Math.max(MIN_WAIT_MS, ms);
}

/**
 * In-process concurrent-stream bound for bulk uploads, split out of
 * `bulk-upload.ts` to keep that route file under its size cap.
 *
 * A single abusive client could otherwise open dozens of parallel streams that
 * each pass the pre-commit byte check and jointly blow past the 1 GiB staging
 * cap before any of them commits. This is NOT a reservation system: the
 * aggregate cap is still enforced at commit under the per-session lock
 * (`enforceStagingLimits`). It just caps how many streams may be mid-flight at
 * once, and refuses a second concurrent stream for the SAME item.
 *
 * RESIDUAL WINDOW: up to {@link MAX_CONCURRENT_STREAMS_PER_SESSION} streams can
 * each be near the cap in the gap between the meter's abort and the commit — a
 * bounded overshoot (≤ 8 × the per-stream ceiling), never an unbounded one.
 */

const MAX_CONCURRENT_STREAMS_PER_SESSION = 8;
const inFlightStreams = new Map<string, Set<string>>();

/** Why {@link beginStream} refused, or `"ok"` when a slot was reserved. */
export type StreamGateResult = "ok" | "duplicate" | "too-many";

/** Reserve a concurrent-stream slot for `itemId`, or say why it can't. */
export function beginStream(sessionId: string, itemId: string): StreamGateResult {
  const set = inFlightStreams.get(sessionId) ?? new Set<string>();
  if (set.has(itemId)) return "duplicate";
  if (set.size >= MAX_CONCURRENT_STREAMS_PER_SESSION) return "too-many";
  set.add(itemId);
  inFlightStreams.set(sessionId, set);
  return "ok";
}

/** Release the concurrent-stream slot for `itemId` (drops the session entry when empty). */
export function endStream(sessionId: string, itemId: string): void {
  const set = inFlightStreams.get(sessionId);
  if (!set) return;
  set.delete(itemId);
  if (set.size === 0) inFlightStreams.delete(sessionId);
}

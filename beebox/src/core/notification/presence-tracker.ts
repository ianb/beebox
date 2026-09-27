/**
 * The server's in-memory presence count for one box: web sessions (one random
 * id per tab) heard from by heartbeat within the last 90 seconds. Pure: the
 * caller passes the time and writes `.beebox/presence.json` when
 * {@link PresenceTracker.due} says so. See docs/implemented-plans/notifications.md
 * (Track A, presence).
 *
 * Write rule: when the count differs from the last written count (including a
 * drop to zero, written once), and at least every 30 seconds while nonzero, so
 * a reader never sees a live count go stale.
 */

const SESSION_TTL_MS = 90_000;
const REFRESH_MS = 30_000;
/** A client picks its own id, so the map is bounded; the oldest session is dropped past this. */
const MAX_SESSIONS = 64;

export interface PresenceTracker {
  /** Record a heartbeat from one tab. */
  heard(sessionId: string, now: Date): void;
  /** Sessions heard from within the last 90 seconds. */
  count(now: Date): number;
  /** The count to write now, or null when the file is current. */
  due(now: Date): number | null;
  /** Record that `activeWeb` was written at `now`. */
  written(opts: { activeWeb: number; now: Date }): void;
}

export function createPresenceTracker(): PresenceTracker {
  const lastSeen = new Map<string, number>();
  let lastWrite: { activeWeb: number; at: number } | null = null;

  function expire(now: Date): void {
    for (const [id, at] of lastSeen) {
      if (now.getTime() - at > SESSION_TTL_MS) lastSeen.delete(id);
    }
  }

  const tracker: PresenceTracker = {
    heard(sessionId, now) {
      lastSeen.delete(sessionId);
      lastSeen.set(sessionId, now.getTime());
      if (lastSeen.size > MAX_SESSIONS) {
        const oldest = lastSeen.keys().next().value;
        if (oldest !== undefined) lastSeen.delete(oldest);
      }
    },
    count(now) {
      expire(now);
      return lastSeen.size;
    },
    due(now) {
      const activeWeb = tracker.count(now);
      if (lastWrite === null) return activeWeb > 0 ? activeWeb : null;
      if (activeWeb !== lastWrite.activeWeb) return activeWeb;
      if (activeWeb > 0 && now.getTime() - lastWrite.at >= REFRESH_MS) return activeWeb;
      return null;
    },
    written({ activeWeb, now }) {
      lastWrite = { activeWeb, at: now.getTime() };
    },
  };
  return tracker;
}

/**
 * The server's presence trackers, one per box with someone present. A
 * heartbeat creates the box's entry and starts a sweep that keeps
 * `.beebox/presence.json` current (`presence-tracker.ts` says when a write is
 * due); once the drop to zero is written, the sweep stops and the entry is
 * removed, so the map holds only boxes someone is using. See
 * docs/plans/notifications.md (Track A, presence).
 */

import { createPresenceTracker, type PresenceTracker } from "./presence-tracker.js";
import { writePresence } from "./presence.js";

interface BoxPresence {
  tracker: PresenceTracker;
  sweep: ReturnType<typeof setInterval> | null;
}

export interface PresenceRegistry {
  /** Record a heartbeat from one tab of a box and write the file if due. */
  heartbeat(boxRoot: string, sessionId: string): Promise<void>;
  /** One sweep for a box: what the interval runs. */
  sweep(boxRoot: string): Promise<void>;
  /** How many boxes have an entry. */
  size(): number;
}

export function createPresenceRegistry(opts: { sweepMs: number; now: (boxRoot: string) => Date }): PresenceRegistry {
  const boxes = new Map<string, BoxPresence>();

  function startSweep(boxRoot: string, entry: BoxPresence): void {
    entry.sweep = setInterval(() => {
      registry.sweep(boxRoot).catch((e: unknown) => {
        console.warn("[presence] could not write presence.json; notifications may treat the box as unattended:", e);
      });
    }, opts.sweepMs);
    entry.sweep.unref();
  }

  /** Write the file when the tracker says it is due; keep sweeping while anyone is present. */
  async function flush(boxRoot: string, entry: BoxPresence): Promise<void> {
    const now = opts.now(boxRoot);
    const activeWeb = entry.tracker.due(now);
    if (activeWeb !== null) {
      await writePresence(boxRoot, { activeWeb, now });
      entry.tracker.written({ activeWeb, now });
    }
    const anyone = entry.tracker.count(now) > 0;
    if (anyone && entry.sweep === null) {
      startSweep(boxRoot, entry);
    } else if (!anyone && activeWeb === null) {
      // The zero is written and nobody is left: forget the box.
      if (entry.sweep !== null) clearInterval(entry.sweep);
      entry.sweep = null;
      boxes.delete(boxRoot);
    }
  }

  const registry: PresenceRegistry = {
    async heartbeat(boxRoot, sessionId) {
      let entry = boxes.get(boxRoot);
      if (entry === undefined) {
        entry = { tracker: createPresenceTracker(), sweep: null };
        boxes.set(boxRoot, entry);
      }
      entry.tracker.heard(sessionId, opts.now(boxRoot));
      await flush(boxRoot, entry);
    },
    async sweep(boxRoot) {
      const entry = boxes.get(boxRoot);
      if (entry !== undefined) await flush(boxRoot, entry);
    },
    size() {
      return boxes.size;
    },
  };
  return registry;
}

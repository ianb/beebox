/**
 * The live-subprocess cap for the chat registry.
 *
 * A box may hold several chat entries but only a few running subprocesses.
 * Before a send spawns one, the least-recently-used live session that nobody
 * is listening to gives its subprocess up (the entry stays, so the chat
 * resumes on its next message).
 *
 * Split from `registry.ts` for that file's line budget.
 */

import { makeLog } from "./log.js";
import type { RegistryEntry } from "./registry-options.js";

const log = makeLog("ChatSessionRegistry");

export function enforceLiveCap(
  entries: Map<string, RegistryEntry>,
  opts: { maxLive: number; currentSessionId: string },
): void {
  const live: { id: string; entry: RegistryEntry }[] = [];
  for (const [id, entry] of entries) {
    if (entry.session.isRunning()) live.push({ id, entry });
  }
  // The session that's about to start is presumably already in `entries`
  // (getOrCreate ran), but it may or may not have a subprocess yet. The cap
  // counts processes about to exist.
  if (live.length < opts.maxLive) return;

  // Evict the oldest live entry that isn't the current session and has no
  // in-flight listeners.
  live.sort((a, b) => a.entry.lastSubprocessUse - b.entry.lastSubprocessUse);
  for (const candidate of live) {
    if (candidate.id === opts.currentSessionId) continue;
    if (candidate.entry.refCount > 0) continue;
    log("evict", `Stopping subprocess for ${candidate.id} (LRU under cap)`);
    candidate.entry.session.stop();
    return;
  }
  log("evict", `Live cap reached but no evictable candidate (refcounts: ${live.map((l) => `${l.id}=${l.entry.refCount}`).join(", ")})`);
}

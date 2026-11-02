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

import { makeLog } from "../log.js";
import type { RegistryEntry } from "./options.js";

const log = makeLog("ChatSessionRegistry");
/** What a hung chat's next turn hears; a working chat is held (`isHeld`), so only a stalled one ends here. */
const HUNG_CAUSE = "it had produced no output for 4 hours and was treated as hung";

/** Whether anything still needs this entry's subprocess: a listener or background work. */
function isHeld(entry: RegistryEntry): boolean {
  return entry.refCount > 0 || entry.session.isWorkingInBackground();
}

/** Stop and drop every entry quiet since `cutoff` that nothing holds. */
export function evictIdleEntries(entries: Map<string, RegistryEntry>, cutoff: number): void {
  for (const [id, entry] of entries) {
    if (entry.lastActivity > cutoff || isHeld(entry)) continue;
    log("sweep", `Idle eviction of ${id}`);
    entry.session.stop(HUNG_CAUSE);
    entries.delete(id);
  }
}

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
  // in-flight listeners or background work.
  live.sort((a, b) => a.entry.lastSubprocessUse - b.entry.lastSubprocessUse);
  for (const candidate of live) {
    if (candidate.id === opts.currentSessionId) continue;
    if (isHeld(candidate.entry)) continue;
    log("evict", `Stopping subprocess for ${candidate.id} (LRU under cap)`);
    candidate.entry.session.stop(HUNG_CAUSE);
    return;
  }
  log("evict", `Live cap reached but no evictable candidate (refcounts: ${live.map((l) => `${l.id}=${l.entry.refCount}`).join(", ")})`);
}

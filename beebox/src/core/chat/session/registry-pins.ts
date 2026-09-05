/**
 * Pin bookkeeping for the chat registry: holding a session against idle
 * cleanup while an SSE listener or an in-flight turn needs it.
 *
 * Split from `registry.ts` for that file's line budget. `pinSession` is the
 * interesting one — it works for a session whose id has not arrived yet, whose
 * pin is tracked on the session object and folded into the entry's refCount
 * when the id lands.
 */

import { checkInvariant } from "../../../lib/invariant.js";
import type { ChatSession } from "./index.js";
import type { RegistryEntry } from "./registry-options.js";

/**
 * Increment an entry's SSE-listener refcount. Returns a release function.
 * A release with refCount already 0 means we released more than we pinned — a
 * real bookkeeping bug. Log loudly, then clamp (don't crash session cleanup
 * over it) rather than silently masking with Math.max.
 */
export function pinEntry(entry: RegistryEntry | undefined): () => void {
  if (entry === undefined) return () => {};
  entry.refCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (!checkInvariant(entry.refCount > 0, "chat-session pin refCount underflow")) entry.refCount = 0;
    else entry.refCount -= 1;
  };
}

/**
 * Pin a session for the life of a turn, working even for a pending "new"
 * session whose id hasn't arrived. If the session already has an entry this is
 * just `pinEntry`; otherwise the pin is tracked on the session and folded into
 * the entry's refCount on promotion, then released against whichever place the
 * session lives in when the turn ends.
 */
export function pinSessionObject(opts: {
  session: ChatSession;
  entries: Map<string, RegistryEntry>;
  pendingPins: Map<ChatSession, number>;
}): () => void {
  const { session, entries, pendingPins } = opts;
  const id = session.getSessionId();
  if (id !== null && entries.has(id)) return pinEntry(entries.get(id));
  pendingPins.set(session, (pendingPins.get(session) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const assignedId = session.getSessionId();
    const entry = assignedId !== null ? entries.get(assignedId) : undefined;
    if (entry) {
      // Promoted before release: the pin became part of refCount.
      if (!checkInvariant(entry.refCount > 0, "chat-session pinSession refCount underflow")) entry.refCount = 0;
      else entry.refCount -= 1;
      return;
    }
    const remaining = (pendingPins.get(session) ?? 1) - 1;
    if (remaining <= 0) pendingPins.delete(session);
    else pendingPins.set(session, remaining);
  };
}

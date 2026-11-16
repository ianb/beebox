/**
 * What a page reload would lose right now.
 *
 * A module that holds state a reload would destroy — a draft, a streaming
 * reply, an upload, a recording, unsaved Compose edits — registers a probe
 * here for as long as it exists. The build-skew reload (`lib/build-skew/`)
 * reloads by itself only when no probe answers true; otherwise it shows a
 * banner and lets the person choose.
 *
 * Probes are read when the decision is made, never cached. A probe that throws
 * counts as blocking: an unknown answer must not reload the page. New state
 * that a reload would lose needs a probe here, or the tab can reload under it.
 */

export type ReloadBlockReason = "composer" | "streaming" | "upload" | "recording" | "compose-edits";

interface Blocker {
  reason: ReloadBlockReason;
  isBlocking: () => boolean;
}

const blockers = new Set<Blocker>();

/** Register a probe; returns its unregister. For a hold with no condition, pass `() => true`. */
export function registerReloadBlocker(reason: ReloadBlockReason, isBlocking: () => boolean): () => void {
  const blocker: Blocker = { reason, isBlocking };
  blockers.add(blocker);
  return () => {
    blockers.delete(blocker);
  };
}

/** The reasons that block a reload now, each once, in registration order. */
export function activeReloadBlockers(): ReloadBlockReason[] {
  const active = new Set<ReloadBlockReason>();
  for (const blocker of blockers) {
    if (active.has(blocker.reason)) continue;
    let blocking: boolean;
    try {
      blocking = blocker.isBlocking();
    } catch (error) {
      console.warn(`[build] reload probe "${blocker.reason}" failed; treating it as blocking`, error);
      blocking = true;
    }
    if (blocking) active.add(blocker.reason);
  }
  return [...active];
}

/**
 * When a chat's trigger activations last changed, per session, bumped by the
 * `trigger-changed` bus event (and by a person's message, since a turn can
 * expire an activation with no event). The status line refetches on a bump.
 * Module-level like `model-availability-store`: the event lands in `ws.ts`,
 * the line sits in the composer region.
 */

import { useSyncExternalStore } from "react";

const versions = new Map<string, number>();
const listeners = new Set<() => void>();

export function noteTriggerChanged(sessionId: string): void {
  versions.set(sessionId, (versions.get(sessionId) ?? 0) + 1);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A number that changes whenever the session's activations may have changed. */
export function useTriggerVersion(sessionId: string | null): number {
  return useSyncExternalStore(subscribe, () => (sessionId === null ? 0 : versions.get(sessionId) ?? 0), () => 0);
}

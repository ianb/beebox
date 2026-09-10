/**
 * HQ transcription failure store — a permanent failure from the HQ pass
 * (`POST /api/chat/transcribe-audio`, Track 6 of
 * `docs/plans/secret-entry-guidance.md`) is shown once on the voice chip
 * instead of only reaching `console.warn`, because the realtime fallback
 * masks the failure completely otherwise: the box still "works", just worse,
 * with no way for the boxholder to learn why.
 *
 * Module-level, framework-free (the house store pattern — see
 * `components/ui/toast-store.ts`), bound to React via `useSyncExternalStore`
 * in `useHqFailure`. One failure at a time: a new distinct `code` replaces
 * the current notice, and the same `code` recurring is a no-op (shown once
 * per distinct code per page load, per the plan) rather than restarting or
 * duplicating it.
 */

import { useSyncExternalStore } from "react";

export interface HqFailure {
  readonly code: string;
  readonly message: string;
}

let current: HqFailure | null = null;
const seenCodes = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Publish a permanent HQ failure, unless this `code` has already been shown once this page load. */
export function publishHqFailure(failure: HqFailure): void {
  if (seenCodes.has(failure.code)) return;
  seenCodes.add(failure.code);
  current = failure;
  notify();
}

/** Dismiss the current notice (the chip's dismiss action). Does not forget the code was shown. */
export function clearHqFailure(): void {
  if (current === null) return;
  current = null;
  notify();
}

/**
 * An HQ pass succeeded: whatever was wrong is fixed (the key was added, the
 * service switched), so the notice goes and the codes are forgotten — a
 * later recurrence is news again, not a repeat.
 */
export function hqSucceeded(): void {
  seenCodes.clear();
  clearHqFailure();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): HqFailure | null {
  return current;
}

/** The current HQ failure notice, or null. Re-renders the caller on publish/clear. */
export function useHqFailure(): HqFailure | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

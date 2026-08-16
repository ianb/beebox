/**
 * Per-chat overlay store for the two audio-review bus events
 * (`chat-retranscription` / `chat-audio-consulted`,
 * docs/plans/retranscription-in-chat.md Track 3): a `messageId -> overlay`
 * map the WS event handlers (`InteractiveChat-ws.ts`) write into and
 * `UserMessage` reads from.
 *
 * Modeled on `input-store.ts`'s external-store pattern rather than lifting
 * this into `InteractiveChat`'s machine-derived React state: these events
 * arrive rarely (at most a couple of times per session) and target exactly
 * one message, so a plain `useState` at the root would re-render the whole
 * message list on every event for no reason (see components/chat/CLAUDE.md
 * on keeping the root's re-render surface small). Subscriptions are keyed by
 * messageId, so only the one bubble whose overlay changed re-renders.
 */

import { useCallback, useSyncExternalStore } from "react";

/** The improved-transcription half of an overlay entry. */
export interface RetranscriptionOverlay {
  newText: string;
  service?: string;
  diarized: boolean;
  recordedAt?: string;
}

/** Overlay state for one message. `consulted` is sticky — never cleared. */
export interface AudioOverlayEntry {
  retranscription?: RetranscriptionOverlay;
  consulted?: true;
}

type Listener = () => void;

export interface AudioOverlayStore {
  /** Non-subscribing read — for callers that don't need to re-render on change. */
  getEntry: (messageId: string) => AudioOverlayEntry | undefined;
  /** Subscribe to changes for one messageId; returns an unsubscribe. */
  subscribe: (messageId: string, listener: Listener) => () => void;
  /** A later retranscription for the same message overwrites the earlier one. */
  applyRetranscription: (messageId: string, overlay: RetranscriptionOverlay) => void;
  /** Sticky: a repeat consult is a no-op (no redundant re-render). */
  applyConsulted: (messageId: string) => void;
}

export function createAudioOverlayStore(): AudioOverlayStore {
  const entries = new Map<string, AudioOverlayEntry>();
  const listeners = new Map<string, Set<Listener>>();

  function notify(messageId: string): void {
    for (const listener of listeners.get(messageId) ?? []) listener();
  }

  return {
    getEntry: (messageId) => entries.get(messageId),
    subscribe: (messageId, listener) => {
      let set = listeners.get(messageId);
      if (!set) {
        set = new Set();
        listeners.set(messageId, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(messageId);
      };
    },
    applyRetranscription: (messageId, overlay) => {
      const prev = entries.get(messageId);
      entries.set(messageId, { ...prev, retranscription: overlay });
      notify(messageId);
    },
    applyConsulted: (messageId) => {
      const prev = entries.get(messageId);
      if (prev?.consulted) return;
      entries.set(messageId, { ...prev, consulted: true });
      notify(messageId);
    },
  };
}

const EMPTY_UNSUBSCRIBE = (): void => {};

/**
 * Subscribing read of one message's overlay entry. `store`/`messageId` are
 * both nullable so a caller can call this unconditionally (e.g. before an
 * entry has resolved a key) — a null store or id simply never has an entry
 * and never subscribes.
 */
export function useAudioOverlayEntry(
  store: AudioOverlayStore | undefined,
  messageId: string | null,
): AudioOverlayEntry | undefined {
  const subscribe = useCallback(
    (listener: Listener) => {
      if (!store || messageId === null) return EMPTY_UNSUBSCRIBE;
      return store.subscribe(messageId, listener);
    },
    [store, messageId],
  );
  const getSnapshot = useCallback(
    () => (store && messageId !== null ? store.getEntry(messageId) : undefined),
    [store, messageId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

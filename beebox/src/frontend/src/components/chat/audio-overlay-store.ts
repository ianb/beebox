/**
 * Per-chat overlay store for the two audio-review bus events
 * (`chat-retranscription` / `chat-audio-consulted`,
 * docs/implemented-plans/retranscription-in-chat.md Track 3): a `messageId -> overlay`
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

/**
 * Overlay state for one message. `consulted` is sticky — never cleared;
 * each ask-about-audio appends its question (shown in the badge popover).
 */
export interface AudioOverlayEntry {
  retranscription?: RetranscriptionOverlay;
  consulted?: { questions: readonly string[] };
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
  applyConsulted: (messageId: string, question: string) => void;
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
    applyConsulted: (messageId, question) => {
      const prev = entries.get(messageId);
      // Append, deduping an identical re-ask (a retried command shouldn't
      // double the list); order preserved otherwise.
      const questions = prev?.consulted?.questions.includes(question)
        ? prev.consulted.questions
        : [...(prev?.consulted?.questions ?? []), question];
      entries.set(messageId, { ...prev, consulted: { questions } });
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

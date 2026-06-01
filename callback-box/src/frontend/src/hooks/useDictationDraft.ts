/**
 * Persists the in-flight dictation transcript to localStorage so an
 * interrupted narration session (screen sleep, tab eviction, reload, crash)
 * doesn't erase what the user said. The transcript otherwise lives only in the
 * transcription machine's in-memory context — gone the moment the page reloads
 * or the machine restarts.
 *
 * Two layers, per the design:
 *   1. Continuous persistence — the transcript is debounce-written while the
 *      user speaks, so a drop loses at most the last few hundred ms.
 *   2. Erasure protection — empty transcripts are never written, so a
 *      START-after-drop (which clears the machine context) can't blow away the
 *      saved draft. Only an explicit `clearDraft()` (a successful send, or the
 *      user discarding) removes it.
 *
 * Recovery is surfaced by `recoveredDraft`; the consumer renders a dedicated
 * widget rather than auto-filling the composer.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { draftKey, parseDraft, serializeDraft, type DictationDraft } from "../lib/dictation-draft";

const PERSIST_DEBOUNCE_MS = 400;

export interface DictationDraftApi {
  /** The persisted draft for this session, or null when none is stored. */
  recoveredDraft: DictationDraft | null;
  /** Remove the stored draft (cancels any pending write). Call on send/discard. */
  clearDraft: () => void;
}

function readDraft(key: string): DictationDraft | null {
  if (typeof window === "undefined") return null;
  return parseDraft(window.localStorage.getItem(key));
}

export function useDictationDraft(opts: {
  boxSlug: string | undefined;
  sessionId: string | null;
  transcript: string;
  isTranscribing: boolean;
  narrationEnabled: boolean;
}): DictationDraftApi {
  const { boxSlug, sessionId, transcript, isTranscribing, narrationEnabled } = opts;
  const key = draftKey({ boxSlug, sessionId });

  const [recoveredDraft, setRecoveredDraft] = useState<DictationDraft | null>(() => readDraft(key));
  const timerRef = useRef<number | null>(null);

  const cancelPending = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const writeDraft = useCallback((text: string) => {
    const draft: DictationDraft = { text, narration: narrationEnabled, updatedAt: Date.now() };
    window.localStorage.setItem(key, serializeDraft(draft));
    setRecoveredDraft(draft);
  }, [key, narrationEnabled]);

  const clearDraft = useCallback(() => {
    cancelPending();
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
    setRecoveredDraft(null);
  }, [key, cancelPending]);

  // Re-read when the storage key changes (e.g. a new chat gets its server
  // session id, or the user switches sessions) so the widget reflects the
  // right draft.
  useEffect(() => {
    setRecoveredDraft(readDraft(key));
  }, [key]);

  // Continuous, debounced persistence. Empty transcripts are deliberately not
  // written: that's what protects a saved draft from a START-after-drop that
  // resets the machine context to "".
  useEffect(() => {
    const text = transcript.trim();
    if (!text) return;
    cancelPending();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      writeDraft(text);
    }, PERSIST_DEBOUNCE_MS);
    return cancelPending;
  }, [transcript, writeDraft, cancelPending]);

  // Insurance against the debounce gap: when the tab is hidden (iOS screen
  // lock / app switch — the exact moment a session is most likely to drop),
  // flush the current transcript synchronously. Empty stays unwritten.
  useEffect(() => {
    function onHide(): void {
      if (document.visibilityState !== "hidden") return;
      const text = transcript.trim();
      if (!text || !isTranscribing) return;
      cancelPending();
      writeDraft(text);
    }
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [transcript, isTranscribing, writeDraft, cancelPending]);

  return { recoveredDraft, clearDraft };
}

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
 * Recovery is surfaced by `recoveredDraft`, which is the draft found *at mount*
 * — i.e. one persisted by a PREVIOUS page life (reload, tab eviction, crash).
 * Drafts written during the current session are NOT surfaced: doing so fired
 * the recovery widget every time the mic legitimately paused mid-conversation
 * (TTS playback, the gap between narration segments, while a turn is
 * processing), treating live in-progress speech as if it had been lost. Live
 * writes are insurance for the *next* reload, not a signal about this session.
 *
 * Trade-off: an in-session drop where the page itself survives (WS closes but
 * no reload) won't pop the widget — only a reload/eviction will. That's the
 * case the original feedback was about, and it's worth the cost of never
 * false-alarming during a normal conversation. The consumer renders a
 * dedicated widget rather than auto-filling the composer.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { draftKey, parseDraft, serializeDraft, adoptLegacyDictationDrafts, type DictationDraft } from "../lib/dictation-draft";

const PERSIST_DEBOUNCE_MS = 400;

export interface DictationDraftApi {
  /** The persisted draft for this box, or null when none is stored. */
  recoveredDraft: DictationDraft | null;
  /** Remove the stored draft (cancels any pending write). Call on send/discard. */
  clearDraft: () => void;
}

/**
 * Read the singleton draft, one-shot-adopting the most-recent legacy
 * per-session draft the first time the singleton key is absent (see
 * `adoptLegacyDictationDrafts`). Named behavior change: other sessions'
 * stale dictation drafts are discarded, not merged — mirrors the composer's
 * singleton-draft adoption.
 */
function readDraft(key: string, boxSlug: string | undefined): DictationDraft | null {
  if (typeof window === "undefined") return null;
  const existing = parseDraft(window.localStorage.getItem(key));
  if (existing !== null) return existing;
  const { adopted, discarded } = adoptLegacyDictationDrafts(window.localStorage, boxSlug);
  if (adopted !== null) {
    window.localStorage.setItem(key, serializeDraft(adopted));
    console.info(
      `[dictation-draft] adopted the most recent unsent dictation draft for this box (${discarded} other draft(s) discarded)`,
    );
  }
  return adopted;
}

export function useDictationDraft(opts: {
  boxSlug: string | undefined;
  transcript: string;
  isTranscribing: boolean;
  narrationEnabled: boolean;
}): DictationDraftApi {
  const { boxSlug, transcript, isTranscribing, narrationEnabled } = opts;
  const key = draftKey({ boxSlug });

  // The recovery candidate: the draft present at mount. Deliberately NOT
  // updated by live writes — see the file header for why surfacing live
  // writes is a false-positive machine. The key is a per-box singleton now
  // (chunk 4), so — unlike the retired per-session key — it doesn't change
  // across a session switch; only a different box changes it.
  const [recoveredDraft, setRecoveredDraft] = useState<DictationDraft | null>(() => readDraft(key, boxSlug));
  const timerRef = useRef<number | null>(null);
  // Whether the user has dictated anything this mount. Once true, the
  // mount-time draft is superseded by live work and must not resurface.
  const startedRef = useRef(false);

  const cancelPending = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Persist to storage only — never touches `recoveredDraft`, so a live
  // session can't surface its own in-progress transcript as "recovered".
  const writeDraft = useCallback((text: string) => {
    const draft: DictationDraft = { text, narration: narrationEnabled, updatedAt: Date.now() };
    window.localStorage.setItem(key, serializeDraft(draft));
  }, [key, narrationEnabled]);

  const clearDraft = useCallback(() => {
    cancelPending();
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
    setRecoveredDraft(null);
  }, [key, cancelPending]);

  // No key-change effect: the key is a per-box singleton (chunk 4), so it no
  // longer changes across a session switch the way the retired per-session
  // key did — only a different box would change it, and that's a full route
  // change (a fresh mount, which already re-reads via the `useState`
  // initializer above).

  // Once the user begins dictating this mount, drop the mount-time draft so
  // it can't reappear as "recovered" when the mic later pauses.
  useEffect(() => {
    if (isTranscribing && !startedRef.current) {
      startedRef.current = true;
      setRecoveredDraft(null);
    }
  }, [isTranscribing]);

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

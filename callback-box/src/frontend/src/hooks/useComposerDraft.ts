/**
 * Persists the unsent composer text to localStorage and restores it
 * automatically, so an interrupted edit (screen sleep, tab eviction, reload, or
 * a component remount) doesn't erase what the user typed but hadn't sent.
 *
 * Unlike the voice-dictation draft — which surfaces in a recovery widget
 * because a live mic pausing mid-conversation made auto-fill a false-positive
 * machine — typed text is restored straight into the composer. It's the same
 * field the user was typing in; it should simply still be there.
 *
 * Lifecycle:
 *   - Persist: non-empty text is debounce-written while the user types; an
 *     emptied composer (a send, or the user clearing it) removes the draft
 *     immediately so a remount an instant later can't resurrect already-sent
 *     text.
 *   - Flush-on-hide: when the tab is hidden (the sleep / app-switch moment) the
 *     current text is written synchronously, closing the debounce gap.
 *   - Restore: once per storage key — on mount, and when a "new" chat gets its
 *     server id — the saved draft fills the composer, but only when it's empty
 *     so it can never clobber text the user is actively typing.
 */

import { useCallback, useEffect, useRef } from "react";
import { composerDraftKey, parseComposerDraft, serializeComposerDraft } from "../lib/composer-draft.js";

const PERSIST_DEBOUNCE_MS = 400;
// Drafts older than this are dropped instead of restored: a week-old unsent
// line silently reappearing would be more surprising than helpful.
const MAX_RESTORE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function useComposerDraft(opts: {
  boxSlug: string | undefined;
  sessionId: string | null;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
}): void {
  const { boxSlug, sessionId, input, setInput } = opts;
  const key = composerDraftKey({ boxSlug, sessionId });
  const timerRef = useRef<number | null>(null);

  const cancelPending = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Restore the saved draft into an empty composer, once per storage key.
  const restoredKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (restoredKeyRef.current === key) return;
    restoredKeyRef.current = key;
    if (typeof window === "undefined") return;
    const draft = parseComposerDraft(window.localStorage.getItem(key));
    if (draft === null) return;
    if (Date.now() - draft.updatedAt > MAX_RESTORE_AGE_MS) {
      window.localStorage.removeItem(key);
      return;
    }
    // Functional update so this can't clobber text typed before the effect ran,
    // and so `input` stays out of the deps (no re-run per keystroke).
    setInput((current) => (current === "" ? draft.text : current));
  }, [key, setInput]);

  // Persist on change. The first guard keeps a fresh, still-empty mount (before
  // the restore effect has read) from deleting a saved draft — only purge once
  // the composer has actually held content this session.
  const hadContentRef = useRef(false);
  useEffect(() => {
    cancelPending();
    if (input.trim() === "") {
      if (hadContentRef.current && typeof window !== "undefined") {
        window.localStorage.removeItem(key);
      }
      return;
    }
    hadContentRef.current = true;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      window.localStorage.setItem(key, serializeComposerDraft({ text: input, updatedAt: Date.now() }));
    }, PERSIST_DEBOUNCE_MS);
    return cancelPending;
  }, [input, key, cancelPending]);

  // Flush synchronously when the tab hides (the sleep / app-switch moment),
  // closing the debounce gap so text typed in the last few hundred ms survives.
  useEffect(() => {
    function onHide(): void {
      if (document.visibilityState !== "hidden") return;
      if (input.trim() === "") return;
      cancelPending();
      window.localStorage.setItem(key, serializeComposerDraft({ text: input, updatedAt: Date.now() }));
    }
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [input, key, cancelPending]);
}

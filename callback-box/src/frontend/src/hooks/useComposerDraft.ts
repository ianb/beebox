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
import type { InputStore } from "../components/chat/input-store";

const PERSIST_DEBOUNCE_MS = 400;
// Drafts older than this are dropped instead of restored: a week-old unsent
// line silently reappearing would be more surprising than helpful.
const MAX_RESTORE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function useComposerDraft(opts: {
  boxSlug: string | undefined;
  sessionId: string | null;
  inputStore: InputStore;
}): void {
  const { boxSlug, sessionId, inputStore } = opts;
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
    // Functional update so this can't clobber text typed before the effect ran.
    inputStore.set((current) => (current === "" ? draft.text : current));
  }, [key, inputStore]);

  // Persist the current text (debounced). The hadContentRef guard keeps a fresh,
  // still-empty mount (before the restore effect has read) from deleting a saved
  // draft — only purge once the composer has actually held content this session.
  const hadContentRef = useRef(false);
  const persist = useCallback(() => {
    cancelPending();
    const value = inputStore.get();
    if (value.trim() === "") {
      if (hadContentRef.current && typeof window !== "undefined") {
        window.localStorage.removeItem(key);
      }
      return;
    }
    hadContentRef.current = true;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      window.localStorage.setItem(key, serializeComposerDraft({ text: inputStore.get(), updatedAt: Date.now() }));
    }, PERSIST_DEBOUNCE_MS);
  }, [inputStore, key, cancelPending]);

  // Persist on every composer change by subscribing to the store directly — no
  // React state, so a keystroke never re-renders this hook's owner. The initial
  // persist() catches a just-restored draft (set before this subscription ran)
  // and re-saves text under a newly-assigned session key.
  useEffect(() => {
    const unsubscribe = inputStore.subscribe(persist);
    persist();
    return () => {
      unsubscribe();
      cancelPending();
    };
  }, [inputStore, persist, cancelPending]);

  // Flush synchronously when the tab hides (the sleep / app-switch moment),
  // closing the debounce gap so text typed in the last few hundred ms survives.
  useEffect(() => {
    function onHide(): void {
      if (document.visibilityState !== "hidden") return;
      const value = inputStore.get();
      if (value.trim() === "") return;
      cancelPending();
      window.localStorage.setItem(key, serializeComposerDraft({ text: value, updatedAt: Date.now() }));
    }
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [inputStore, key, cancelPending]);
}

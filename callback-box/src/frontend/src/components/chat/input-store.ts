/**
 * Composer input store.
 *
 * The composer's text changes on every keystroke. If that text lived in
 * `useState` at the InteractiveChat root, each keystroke would re-render the
 * whole chat subtree — message history and the companion view pane included
 * (the expensive trap this store exists to avoid; see components/chat/CLAUDE.md).
 *
 * Since chunk 2 (docs/plans/input-extraction.md) the text is one slice of the
 * emission store (`../../input/emission-store.ts`), which also holds images,
 * files, and selections — the whole composition. This module is now a thin
 * adapter exposing just the text slice under the original `InputStore` API,
 * so every existing text call site (composer textareas, voice, drafts) is
 * untouched. Only the composer textareas subscribe via `useInputValue()` and
 * re-render on a keystroke; everything else reads the current value at
 * call-time with `get()` and writes with `set()`, neither of which
 * subscribes, so a keystroke never re-renders them.
 *
 * `set()` mirrors React's state-setter contract (a value or an updater) so
 * existing `setInput(...)` call sites carry over unchanged.
 *
 * Since chunk 4 (docs/plans/input-extraction.md), the emission store
 * instance is created ABOVE the `key={keyState.epoch}` remount in
 * `ChatPage` (via `useEmissionStoreInstance`) so it survives a session
 * switch, and passed into `InteractiveChat` as a prop. `InteractiveChat`
 * derives its text-only `InputStore` view with `createInputStoreAdapter`.
 */

import { createContext, useContext, useState, useSyncExternalStore } from "react";
import { createEmissionStore, type EmissionStore } from "../../input/emission-store";

export interface InputStore {
  /** Current composer text. Read at call-time; does not subscribe. */
  get: () => string;
  /** Set the composer text. Accepts a value or an updater, like React's setter. */
  set: (next: string | ((prev: string) => string)) => void;
  /** Subscribe to changes; returns an unsubscribe. Backs `useInputValue` / draft persistence. */
  subscribe: (listener: () => void) => () => void;
  /**
   * The full emission store this text slice is drawn from, when there is
   * one — absent for standalone stores (e.g. the dev composer-states
   * gallery) that fabricate an `InputStore` without a backing emission.
   * Reach it via `useEmissionStore()`, not this field directly.
   */
  emissionStore?: EmissionStore;
}

class MissingInputStoreError extends Error {
  constructor() {
    super("useInputStore must be used within an InputStoreProvider");
    this.name = "MissingInputStoreError";
  }
}

class MissingEmissionStoreError extends Error {
  constructor() {
    super("useEmissionStore must be used within an InputStoreProvider backed by an emission store");
    this.name = "MissingEmissionStoreError";
  }
}

export function createInputStoreAdapter(emissionStore: EmissionStore): InputStore {
  return {
    get: () => emissionStore.get().text,
    set: (next) => emissionStore.editor.setText(next),
    subscribe: (listener) => emissionStore.subscribe(listener),
    emissionStore,
  };
}

const InputStoreContext = createContext<InputStore | null>(null);
export const InputStoreProvider = InputStoreContext.Provider;

/**
 * The lifted emission store instance: created once in `ChatPage` (above the
 * `InteractiveChat` remount boundary) so the composition — text, images,
 * files, selections — survives a session switch. `InteractiveChat` receives
 * this as a prop and derives its text-only `InputStore` view from it with
 * `createInputStoreAdapter`.
 */
export function useEmissionStoreInstance(): EmissionStore {
  const [instance, setInstance] = useState(() => createEmissionStore());
  void setInstance;
  return instance;
}

export function useInputStore(): InputStore {
  const store = useContext(InputStoreContext);
  if (store === null) throw new MissingInputStoreError();
  return store;
}

/** The emission store backing the current `InputStore`, for consumers that need more than text. */
export function useEmissionStore(): EmissionStore {
  const store = useInputStore();
  if (store.emissionStore === undefined) throw new MissingEmissionStoreError();
  return store.emissionStore;
}

/**
 * Subscribing read of the composer text. The ONLY reactive consumer — calling
 * this is what makes a component re-render on a keystroke, so keep it to the
 * composer textareas.
 */
export function useInputValue(): string {
  const store = useInputStore();
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

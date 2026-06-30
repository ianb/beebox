/**
 * Composer input store.
 *
 * The composer's text changes on every keystroke. If that text lived in
 * `useState` at the InteractiveChat root, each keystroke would re-render the
 * whole chat subtree — message history and the companion view pane included
 * (the expensive trap this store exists to avoid; see components/chat/CLAUDE.md).
 *
 * Instead the text lives in a tiny external store. Only the components that
 * display it — the composer textareas — subscribe via `useInputValue()` and
 * re-render on a keystroke. Everything else (the root, the hooks that mutate
 * input on send/voice/attachments) reads the current value at call-time with
 * `get()` and writes with `set()`, neither of which subscribes, so a keystroke
 * never re-renders them.
 *
 * `set()` mirrors React's state-setter contract (a value or an updater) so
 * existing `setInput(...)` call sites carry over unchanged.
 */

import { createContext, useContext, useState, useSyncExternalStore } from "react";

export interface InputStore {
  /** Current composer text. Read at call-time; does not subscribe. */
  get: () => string;
  /** Set the composer text. Accepts a value or an updater, like React's setter. */
  set: (next: string | ((prev: string) => string)) => void;
  /** Subscribe to changes; returns an unsubscribe. Backs `useInputValue` / draft persistence. */
  subscribe: (listener: () => void) => () => void;
}

class MissingInputStoreError extends Error {
  constructor() {
    super("useInputStore must be used within an InputStoreProvider");
    this.name = "MissingInputStoreError";
  }
}

function createInputStore(initial: string): InputStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      const resolved = typeof next === "function" ? next(value) : next;
      if (resolved === value) return;
      value = resolved;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const InputStoreContext = createContext<InputStore | null>(null);
export const InputStoreProvider = InputStoreContext.Provider;

/**
 * The per-InteractiveChat store instance. Created once and held stable across
 * renders so the root can hand it to hooks without re-subscribing.
 */
export function useInputStoreInstance(): InputStore {
  const [store, setStore] = useState(() => createInputStore(""));
  void setStore;
  return store;
}

export function useInputStore(): InputStore {
  const store = useContext(InputStoreContext);
  if (store === null) throw new MissingInputStoreError();
  return store;
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

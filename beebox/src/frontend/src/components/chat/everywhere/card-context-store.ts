/** Last actively consumed card, with nested overlay restoration and one input sink. */
import type { AddSelectionInput } from "../../../lib/selection/position";

export function createCardContextStore() {
  const cards = new Map<object, string>();
  const listeners = new Set<() => void>();
  let focusedRef: string | null = null;
  let selectionSink: ((selection: AddSelectionInput) => void) | null = null;
  function notify() {
    const next = [...cards.values()].at(-1) ?? null;
    if (next === focusedRef) return;
    focusedRef = next;
    for (const listener of listeners) listener();
  }
  return {
    get: () => focusedRef,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    focus(owner: object, ref: string) { cards.delete(owner); cards.set(owner, ref); notify(); },
    release(owner: object) { cards.delete(owner); notify(); },
    registerSelection(sink: (selection: AddSelectionInput) => void) {
      selectionSink = sink;
      return () => { if (selectionSink === sink) selectionSink = null; };
    },
    capture(selection: AddSelectionInput) {
      if (selectionSink) selectionSink(selection);
      else console.warn("The conversation input is not ready to receive a selection");
    },
  };
}

/** Selection delivery is independent of attention, but hidden material has no sink. */
export function visibleCardSelectionSink(visible: boolean, store: ReturnType<typeof createCardContextStore> | null) {
  return visible ? store?.capture : undefined;
}

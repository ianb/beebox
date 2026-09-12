/** One selection sink shared by visible workspace cards. */
import type { AddSelectionInput } from "../../../lib/selection/position";

export function createCardContextStore() {
  let selectionSink: ((selection: AddSelectionInput) => void) | null = null;
  return {
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

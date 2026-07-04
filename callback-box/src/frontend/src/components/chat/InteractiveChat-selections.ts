/**
 * Composer selection bindings for InteractiveChat: document text the user
 * attached from the companion pane. Mirrors `useChatAttachments` — each
 * capture drops a `[selectionN]` token at the cursor; removal strips it back
 * out; `resetSelections` clears after send. The items are serialized into the
 * outgoing message by `applySelections` (shared across the typed and voice
 * send paths).
 *
 * State lives in the emission store (`../../input/emission-store.ts`,
 * docs/plans/input-extraction.md chunk 2); this hook is a thin React
 * binding subscribing to the selections slice and calling `EmissionEditor`
 * methods for every mutation.
 */

import { useCallback, useSyncExternalStore } from "react";
import { insertTokensAtCursor } from "./InteractiveChat-attachments";
import { type SelectionItem } from "../../lib/selection-serialize";
import { type AddSelectionInput } from "../../lib/selection-position";
import type { EmissionStore } from "../../input/emission-store";

export function useChatSelections(opts: {
  emissionStore: EmissionStore;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}) {
  const { emissionStore, textareaRef } = opts;
  const { editor } = emissionStore;
  const selections = useSyncExternalStore(emissionStore.subscribe, () => emissionStore.get().selections);

  const addSelection = useCallback((selection: AddSelectionInput, voice: { anchor: string | null; spokenWords: number | null }) => {
    const { anchor, spokenWords } = voice;
    const id = editor.nextSelectionId();
    const item: SelectionItem = { id, ref: selection.ref, text: selection.text, position: selection.position, anchor, spokenWords };
    editor.addSelection(item);
    // Voice selections carry a transcript `anchor` (non-null) and are placed
    // by that phrase in applySelections — no textarea token (the textarea is
    // read-only during transcription and shows the transcript, not `input`).
    // Typed selections (anchor === null) insert an inline [selectionN] token
    // at the caret; focus the composer so the user can keep typing.
    if (anchor !== null) {
      return;
    }
    insertTokensAtCursor(`[selection${id}]`, { input: emissionStore.get().text, setInput: editor.setText, textareaRef, alwaysFocus: true });
  }, [editor, emissionStore, textareaRef]);

  const removeSelection = useCallback((id: number) => {
    // Strips the matching `[selectionN]` token from the text too.
    editor.removeSelection(id);
  }, [editor]);

  const resetSelections = useCallback(() => {
    editor.reset("selections");
  }, [editor]);

  return { selections, addSelection, removeSelection, resetSelections };
}

/**
 * Composer selection state for InteractiveChat: document text the user
 * attached from the companion pane. Mirrors `useChatAttachments` — each
 * capture drops a `[selectionN]` token at the cursor; removal strips it back
 * out; `resetSelections` clears after send. The items are serialized into the
 * outgoing message by `applySelections` (shared across the typed and voice
 * send paths).
 */

import { useState, useRef, useCallback } from "react";
import { insertTokensAtCursor } from "./InteractiveChat-attachments";
import { type SelectionItem } from "../../lib/selection-serialize";
import { type AddSelectionInput } from "../../lib/selection-position";
import type { InputStore } from "./input-store";

export function useChatSelections(opts: {
  inputStore: InputStore;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}) {
  const { inputStore, textareaRef } = opts;
  const [selections, setSelections] = useState<SelectionItem[]>([]);
  const nextSelectionIdRef = useRef(1);

  const addSelection = useCallback((selection: AddSelectionInput, voice: { anchor: string | null; spokenWords: number | null }) => {
    const { anchor, spokenWords } = voice;
    const id = nextSelectionIdRef.current++;
    setSelections((prev) => [...prev, { id, ref: selection.ref, text: selection.text, position: selection.position, anchor, spokenWords }]);
    // Voice selections carry a transcript `anchor` (non-null) and are placed
    // by that phrase in applySelections — no textarea token (the textarea is
    // read-only during transcription and shows the transcript, not `input`).
    // Typed selections (anchor === null) insert an inline [selectionN] token
    // at the caret; focus the composer so the user can keep typing.
    if (anchor !== null) {
      return;
    }
    insertTokensAtCursor(`[selection${id}]`, { input: inputStore.get(), setInput: inputStore.set, textareaRef, alwaysFocus: true });
  }, [inputStore, textareaRef]);

  const removeSelection = useCallback((id: number) => {
    setSelections((prev) => prev.filter((s) => s.id !== id));
    inputStore.set((prev) =>
      prev
        .replace(/\s?\[selection(\d+)]\s?/g, (match, n: string) =>
          parseInt(n, 10) === id ? " " : match
        )
        .replace(/ {2,}/g, " ")
    );
  }, [inputStore]);

  const resetSelections = useCallback(() => {
    setSelections([]);
    nextSelectionIdRef.current = 1;
  }, []);

  return { selections, addSelection, removeSelection, resetSelections };
}

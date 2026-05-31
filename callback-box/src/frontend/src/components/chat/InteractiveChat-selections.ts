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

export function useChatSelections(opts: {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}) {
  const { input, setInput, textareaRef } = opts;
  const [selections, setSelections] = useState<SelectionItem[]>([]);
  const nextSelectionIdRef = useRef(1);

  const addSelection = useCallback((selection: AddSelectionInput) => {
    const id = nextSelectionIdRef.current++;
    setSelections((prev) => [...prev, { id, ref: selection.ref, text: selection.text, position: selection.position }]);
    // During live transcription the textarea is read-only and shows the
    // transcript, not `input` — inserting a [selectionN] token would write
    // into the hidden `input` and orphan it there. Skip the token in that
    // case; the spoken message appends the selection (applySelections) and
    // the pill is the on-screen feedback. When typing, insert inline and
    // focus the composer so the user can keep typing after the token.
    const ta = textareaRef.current;
    if (ta !== null && ta.readOnly) {
      return;
    }
    insertTokensAtCursor(`[selection${id}]`, { input, setInput, textareaRef, alwaysFocus: true });
  }, [input, setInput, textareaRef]);

  const removeSelection = useCallback((id: number) => {
    setSelections((prev) => prev.filter((s) => s.id !== id));
    setInput((prev) =>
      prev
        .replace(/\s?\[selection(\d+)]\s?/g, (match, n: string) =>
          parseInt(n, 10) === id ? " " : match
        )
        .replace(/ {2,}/g, " ")
    );
  }, [setInput]);

  const resetSelections = useCallback(() => {
    setSelections([]);
    nextSelectionIdRef.current = 1;
  }, []);

  return { selections, addSelection, removeSelection, resetSelections };
}

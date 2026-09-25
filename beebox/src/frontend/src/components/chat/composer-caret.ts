/**
 * Keep the caret out of text the user did not type.
 *
 * The composer textareas are controlled: their `value` comes from the emission
 * store. So a write the user did not make — restoring a persisted draft,
 * clearing after a send, normalizing tokens — replaces `value` while the
 * browser keeps the text selection at its old character offset. The next
 * keystroke then lands INSIDE the new text instead of after it.
 *
 * That is how a send once went out with a stale draft wrapped around the real
 * message: one message spliced into another at a mid-word offset, stored that
 * way on disk, with no caret-aware code anywhere on the path
 * (issues/bugs/2026-08-22-composer-draft-splices-into-another-message.md). The
 * same stale offset can delete as well as insert — the variant nobody would
 * notice — which is why this guards the mechanism rather than the one reachable
 * route that produced the sighting.
 *
 * A keystroke's own change is left alone: moving the caret there would fight
 * the person typing, who is the only one who knows where they want it.
 */

import { useEffect, useRef } from "react";

/**
 * Where the caret belongs after the composer text became `text`, or `null` to
 * leave it exactly where it is.
 *
 * `lastTyped` is the value the user's own last keystroke produced. Equal means
 * this change IS that keystroke; anything else reached the store another way,
 * and the end of the text is where a person continuing to type expects to be.
 */
export function caretAfterTextChange(input: { text: string; lastTyped: string | null }): number | null {
  return input.lastTyped === input.text ? null : input.text.length;
}

/**
 * Bind {@link caretAfterTextChange} to one textarea. Returns the function each
 * row's `onChange` calls with the value the keystroke produced — without it,
 * every change looks programmatic and the caret would jump to the end as the
 * person types.
 */
export function useComposerCaret(input: {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  text: string;
}): (typed: string) => void {
  const { textareaRef, text } = input;
  const lastTyped = useRef<string | null>(null);
  useEffect(() => {
    const caret = caretAfterTextChange({ text, lastTyped: lastTyped.current });
    if (caret === null) return;
    // A row can be unmounted (the mobile and desktop rows swap at `sm`), and a
    // detached element has nothing to place a caret in.
    textareaRef.current?.setSelectionRange(caret, caret);
  }, [text, textareaRef]);
  return (typed: string) => {
    lastTyped.current = typed;
  };
}

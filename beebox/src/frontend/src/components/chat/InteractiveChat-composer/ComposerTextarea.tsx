/**
 * The composer's message textarea, shared by the desktop row (inline in the
 * button bar) and the phone row (below it while typing or transcribing).
 *
 * It is the one raw `<textarea>` outside `ui/fields/`, because it does what
 * `TextareaField` does not: it grows with its text, keeps the caret out of
 * text the person did not type (`useComposerCaret`), shows a live transcript
 * read-only, and takes the chat's keydown handler, which skips Enter during
 * IME composition (`lib/ime`).
 */

import type { RefObject } from "react";
import { joinTranscript } from "../InteractiveChat-helpers";
import { useComposerCaret } from "./composer-caret";
import type { ComposerRowProps } from "../composer-row-props";

function textareaClasses({ mobile, isTranscribing }: { mobile: boolean; isTranscribing: boolean }): string {
  // Grows with its text (CSS field-sizing, which replaced react-textarea-autosize):
  // at least 1 line (2 on the phone), at most 8, then it scrolls. `box-content`
  // keeps padding and the theme's border out of those line counts.
  const sizeClass = mobile ? "text-base min-h-[2lh]" : "text-sm min-w-0 min-h-[1lh]";
  const stateClass = isTranscribing
    ? "bg-white text-warm-800 border-primary/40 shadow-[0_0_0_1px_rgba(56,149,211,0.08)]"
    : "bg-white border-warm-400";
  return `flex-1 resize-none box-content [field-sizing:content] max-h-[8lh] rounded-lg px-3 py-2 ${sizeClass} ${stateClass} focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent placeholder:text-warm-600`;
}

export function ComposerTextarea({
  id, mobile, textareaRef, input, setInput, isTranscribing, transcript, onKeyDown, onPaste, onDrop,
}: Pick<ComposerRowProps, "isTranscribing" | "onPaste" | "onDrop"> & {
  /** The row's control address: the two rows can be in the DOM at once, so each has its own. */
  id: string | undefined;
  /** The phone row: two lines tall, and Enter inserts a newline (no keydown handler). */
  mobile: boolean;
  textareaRef: RefObject<HTMLTextAreaElement>;
  input: string;
  setInput: (text: string) => void;
  /** The live transcript shown after `input` while transcribing. */
  transcript: string;
  /** Enter-to-send; must skip IME composition. Only the desktop row sends on Enter. */
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  const noteTyped = useComposerCaret({ textareaRef, text: input });
  return (
    <textarea
      id={id}
      ref={textareaRef}
      autoFocus
      enterKeyHint={mobile ? "enter" : "send"}
      aria-label="Message"
      value={isTranscribing ? joinTranscript(input, transcript) : input}
      onChange={(e) => { if (!isTranscribing) { noteTyped(e.target.value); setInput(e.target.value); } }}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onDrop={onDrop}
      readOnly={isTranscribing}
      placeholder={isTranscribing ? "Listening..." : "Type a message..."}
      className={textareaClasses({ mobile, isTranscribing })}
    />
  );
}

/**
 * The box screen's input, pinned below the scrolling sections
 * (docs/plans/box-screen.md, track 2). It edits the new-thought draft, which
 * is stored apart from the chat composer's draft. Enter sends; Shift+Enter
 * adds a line. While a thought is unsent, the line under the input says so.
 *
 * Focus moves here on arrival only with a fine pointer: on a phone the
 * keyboard would cover the screen before the person chose to type.
 */

import { useEffect } from "react";
import { TextareaField } from "../ui/fields/field";
import { Button } from "../ui/Button";
import { Row } from "../ui/Row";

const INPUT_ID = "bbx-box-screen-input";

export function NewThoughtInput({ draft, onChange, onSend, sending, status }: {
  draft: string;
  onChange: (text: string) => void;
  onSend: () => void;
  sending: boolean;
  /** The unsent thought's state, or null when nothing is waiting. */
  status: string | null;
}) {
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) document.getElementById(INPUT_ID)?.focus();
  }, []);
  return (
    <form
      className="shrink-0 border-t border-warm-200 bg-white px-4 py-3"
      aria-busy={sending}
      onSubmit={(event) => { event.preventDefault(); onSend(); }}
    >
      <div className="max-w-xl mx-auto flex flex-col gap-2">
        <Row gap="sm" align="end">
          <TextareaField
            id={INPUT_ID}
            className="flex-1 min-w-0"
            label="New thought. The box picks the conversation."
            value={draft}
            rows={2}
            maxLength={12000}
            disabled={sending}
            onChange={onChange}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <Button id="bbx-box-screen-send" type="submit" intent="primary" disabled={sending || draft.trim() === ""}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </Row>
        <p role="status" className="text-sm text-warm-500 empty:hidden">{status}</p>
      </div>
    </form>
  );
}

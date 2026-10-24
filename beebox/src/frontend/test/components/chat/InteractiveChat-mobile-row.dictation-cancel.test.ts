// The dictation cancel control is a named button on both composer rows.
// It carries its address only when the composer is the product one; a dev
// gallery copy renders without ids.
import { createElement as h, createRef, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "tap";
import { ChatInputArea } from "../../../src/components/chat/InteractiveChat-composer/view.js";
import { MobileTextareaRow } from "../../../src/components/chat/InteractiveChat-mobile-row.js";
import { InputStoreProvider, type InputStore } from "../../../src/components/chat/input-store.js";
import type { ComposerRowProps } from "../../../src/components/chat/composer-row-props.js";

const noop = (): void => { /* a handler the test never calls */ };
const store: InputStore = { get: () => "", set: noop, subscribe: () => noop };

const rowProps: ComposerRowProps = {
  isTranscribing: true,
  transcription: {
    state: "recording", transcript: "", finalWords: null, start: noop,
    stop: () => Promise.resolve({ text: "", words: null }), submitSegment: () => true, cancel: noop,
  },
  targetBusy: false, handleSend: noop, handleCancelTranscription: noop, clearDraft: noop,
  onStopDictation: noop, onVoiceSegmentSend: noop,
};

function render(element: ReactElement): string {
  return renderToStaticMarkup(h(InputStoreProvider, { value: store }, element));
}

function desktop(includeControlIds: boolean): string {
  return render(h(ChatInputArea, {
    ...rowProps, textareaRef: createRef<HTMLTextAreaElement>(), handleKeyDown: noop,
    onKeyboard: noop, onVoice: noop, voicePaused: false, onUnpause: noop, onAddFiles: noop, addFiles: () => Promise.resolve({ added: 0 }),
    onEnterCapture: noop, captureEnabled: false, narrationEnabled: false, includeControlIds,
  }));
}

function mobile(includeControlIds: boolean): string {
  return render(h(MobileTextareaRow, { ...rowProps, includeControlIds }));
}

/** The ids on the buttons named "Cancel dictation (Esc)". */
function cancelButtonIds(html: string): Array<string | null> {
  return [...html.matchAll(/<button\b[^>]*aria-label="Cancel dictation \(Esc\)"[^>]*>/g)]
    .map((match) => /\bid="([^"]*)"/.exec(match[0])?.[1] ?? null);
}

void test("the desktop and mobile cancel buttons are named and addressed", async (t) => {
  t.check(cancelButtonIds(desktop(true)), ["bbx-composer-dictation-cancel"]);
  t.check(cancelButtonIds(mobile(true)), ["bbx-composer-dictation-cancel-mobile"]);
});

void test("a gallery copy renders the cancel buttons without ids", async (t) => {
  t.check(cancelButtonIds(desktop(false)), [null]);
  t.check(cancelButtonIds(mobile(false)), [null]);
});

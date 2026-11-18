/**
 * Page-wide chat keys, listened for on the document like the dictation Escape
 * in voice.ts:
 *
 * - Ctrl+L (the Control key on every platform; Cmd+L stays the browser's)
 *   adds a page text selection to the message, as the top bar's "Select
 *   content" button does, then focuses the composer.
 * - Enter while the mic is live sends the spoken message and keeps the mic
 *   on, like the spoken "send message" without its keyword hint.
 */

import { useEffect, useRef } from "react";
import { captureSelectedText } from "../SelectionCapture";
import { isComposing } from "../../lib/ime";
import { joinTranscript } from "./InteractiveChat-helpers";
import type { TranscriptionState } from "../../hooks/useRealtimeTranscription/hook";

/** Shown on the composer and the selection button (`aria-keyshortcuts`). */
export const COMPOSER_FOCUS_KEYS = "Control+L";

/** The composer textareas' authored addresses (desktop row, phone row). */
const COMPOSER_INPUT_IDS = new Set(["bbx-composer-input", "bbx-composer-input-mobile"]);

function isComposerFocusKey(event: KeyboardEvent): boolean {
  return event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "l";
}

// No `listbox`: search results render one inline at rest, and a popup
// listbox keeps focus in its combobox input, which Enter already skips.
const OVERLAY = "dialog, [role='dialog'], [role='alertdialog'], [aria-modal='true'], [role='menu']";

/**
 * A modal, popover or menu is open somewhere and owns the keyboard. `Menu`,
 * `Popover` and `ModalDialog` mount their panels only while open, and a
 * pointer-opened menu can leave focus on the body or the composer, so the
 * check is on the document, not on the key's target.
 */
function overlayOpen(doc: Document): boolean {
  return doc.querySelector(OVERLAY) !== null;
}

function isComposerInput(element: Element): boolean {
  return element instanceof HTMLTextAreaElement && COMPOSER_INPUT_IDS.has(element.id);
}

/** The composer textarea showing now: the desktop row's, else the phone row's. */
function visibleComposer(doc: Document): HTMLTextAreaElement | null {
  for (const id of COMPOSER_INPUT_IDS) {
    const element = doc.getElementById(id);
    if (element instanceof HTMLTextAreaElement && element.offsetParent !== null) return element;
  }
  return null;
}

/**
 * Whether an Enter keydown belongs to the mic send: plain Enter, from the
 * composer or with nothing focused (the body). Any other focused element —
 * a button, a field, a menu — keeps its own Enter.
 */
function isVoiceSendEnter(event: KeyboardEvent): boolean {
  if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.repeat || event.defaultPrevented || isComposing(event)) return false;
  const target = event.target;
  if (!(target instanceof Element) || overlayOpen(target.ownerDocument)) return false;
  if (target === target.ownerDocument.body || target === target.ownerDocument.documentElement) return true;
  return isComposerInput(target);
}

/**
 * A spoken message worth sending: composer or transcript text, or a segment
 * recorded while live text is paused (its words come from the HQ pass, as the
 * Send button allows). With nothing said, Enter does nothing.
 */
function voiceEnterHasMessage(opts: { input: string; transcript: string; state: TranscriptionState }): boolean {
  if (opts.state === "recordingLocal") return true;
  return joinTranscript(opts.input, opts.transcript).trim().length > 0;
}

export function useChatShortcuts(opts: {
  /** Off under the native composer: the app owns its own input. */
  enabled: boolean;
  ensureComposerVisibleRef: React.MutableRefObject<() => void>;
  isTranscribing: boolean;
  transcription: { state: TranscriptionState; transcript: string; submitSegment: (opts: { closeMic: boolean }) => boolean };
  readInput: () => string;
  sendDisabledReason: string | undefined;
}): void {
  // Read at key time; the listeners mount once.
  const latest = useRef(opts);
  useEffect(() => { latest.current = opts; });

  const { enabled } = opts;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const current = latest.current;
      if (isComposerFocusKey(event)) {
        if (event.defaultPrevented || isComposing(event) || overlayOpen(document)) return;
        event.preventDefault();
        // Captures only a selection inside a capture root; a text field's own
        // selection, or none, leaves the message as it was.
        captureSelectedText();
        const textarea = visibleComposer(document);
        // A closed phone typing row opens and focuses itself.
        if (textarea !== null) textarea.focus();
        else current.ensureComposerVisibleRef.current();
        return;
      }
      if (!current.isTranscribing || !isVoiceSendEnter(event)) return;
      event.preventDefault();
      if (current.sendDisabledReason !== undefined) return;
      const { state, transcript, submitSegment } = current.transcription;
      if (!voiceEnterHasMessage({ input: current.readInput(), transcript, state })) return;
      submitSegment({ closeMic: false });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

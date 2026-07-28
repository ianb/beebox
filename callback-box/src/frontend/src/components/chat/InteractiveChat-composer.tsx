/**
 * The unified composer button bar for InteractiveChat: button bar + inline
 * textarea on desktop, button bar only on mobile. The mobile-only textarea
 * row that drops below the bar lives in InteractiveChat-mobile-row.tsx.
 * Presentational — the transcription handle, input setters, and send
 * callbacks come in as props.
 */

import TextareaAutosize from "react-textarea-autosize";
import { Dropdown, MenuItem } from "../ui/Dropdown";
import { ShareLocationMenuItem } from "./ShareLocationMenuItem";
import { ScreenshotMenuItem } from "./ScreenshotMenuItem";
import { VoiceToggleButton } from "./InteractiveChat-voice-button";
import { MicOverlay } from "./MicOverlay";
import { composerTextareaClasses, joinTranscript } from "./InteractiveChat-helpers";
import { useInputValue, useInputStore } from "./input-store";
import type { TranscriptionState } from "../../hooks/useRealtimeTranscription";

export interface TranscriptionHandle {
  state: TranscriptionState;
  transcript: string;
  start: () => void;
  stop: () => Promise<string>;
  cancel: () => void;
}

const CIRCLE_BTN = "flex items-center justify-center w-14 h-14 rounded-full flex-shrink-0";

const SEND_PATH = "M5 10l7-7m0 0l7 7m-7-7v18";

/**
 * Desktop-only inline textarea plus its trailing send / transcription-action
 * buttons. Hidden below the `sm` breakpoint.
 */
function DesktopComposerRow({
  textareaRef, input, setInput, isTranscribing, transcription, targetBusy,
  handleKeyDown, handleSend, handleCancelTranscription, clearDraft,
  onStopDictation, onVoiceSegmentSend, onPaste, onDrop,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  isTranscribing: boolean;
  transcription: TranscriptionHandle;
  /** Chat target status is busy (streaming/refreshing) — a send will queue, not run immediately. */
  targetBusy: boolean;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  handleSend: () => void;
  handleCancelTranscription: () => void;
  clearDraft: () => void;
  onStopDictation: () => void;
  onVoiceSegmentSend: (text: string) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <div className="hidden sm:flex flex-1 items-center gap-2 min-w-0">
      <TextareaAutosize
        ref={textareaRef}
        autoFocus
        enterKeyHint="send"
        value={isTranscribing ? joinTranscript(input, transcription.transcript) : input}
        onChange={(e) => { if (!isTranscribing) setInput(e.target.value); }}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        onDrop={onDrop}
        readOnly={isTranscribing}
        placeholder={isTranscribing ? "Listening..." : "Type or paste an image..."}
        className={composerTextareaClasses({ mobile: false, isTranscribing })}
        minRows={1}
        maxRows={8}
      />
      {isTranscribing ? (
        <>
          <button
            onClick={handleCancelTranscription}
            className="p-2 text-danger hover:text-danger-dark rounded-lg hover:bg-danger-50 flex-shrink-0"
            title="Cancel (Esc)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <button
            onClick={() => {
              onStopDictation();
              const text = transcription.transcript;
              transcription.cancel();
              if (text) setInput((existing) => (existing ? existing + " " + text : text));
              // Now editable typed text, not voice — drop the dictation draft.
              clearDraft();
            }}
            className="p-2 text-coral hover:text-coral-dark rounded-lg hover:bg-coral-50 flex-shrink-0"
            title="Edit before sending"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          <button
            onClick={() => {
              // Continue from any prior composer text so it isn't dropped.
              const text = joinTranscript(input, transcription.transcript).trim();
              transcription.cancel();
              if (text) onVoiceSegmentSend(text);
              setInput("");
              // Segment committed — drop the persisted dictation draft.
              clearDraft();
            }}
            disabled={!joinTranscript(input, transcription.transcript).trim()}
            className={`${CIRCLE_BTN} bg-accent text-white hover:bg-accent-dark disabled:bg-info-muted disabled:text-white/70 disabled:cursor-not-allowed`}
            title="Send"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={SEND_PATH} />
            </svg>
          </button>
        </>
      ) : (
        <button
          onClick={handleSend}
          disabled={!input.trim()}
          className={`${CIRCLE_BTN} bg-accent text-white hover:bg-accent-dark disabled:bg-info-muted disabled:text-white/70 disabled:cursor-not-allowed`}
          title={targetBusy ? "Queue message (agent is busy)" : "Send"}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={SEND_PATH} />
          </svg>
        </button>
      )}
    </div>
  );
}

/**
 * Unified input area: button bar + inline textarea on desktop, button bar only on mobile.
 * On desktop (sm:+): [capture] [camera] [textarea...] [send] [stop] [voice] in one row.
 * On mobile: [capture] [camera] [spacer] [stop] [keyboard] [voice] — textarea appears below when typing.
 */
export function ChatInputArea({
  textareaRef, isTranscribing, transcription, targetBusy,
  handleKeyDown, handleSend, handleCancelTranscription, clearDraft,
  onKeyboard, onVoice, onStopDictation, onVoiceSegmentSend,
  voicePaused, onUnpause, hideMobile,
  onPaste, onDrop, onAttachFiles, addImageFiles, onEnterCapture, captureEnabled, captureDisabledReason,
  onUploadFiles, uploadFilesDisabledReason, narrationEnabled,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  isTranscribing: boolean;
  transcription: TranscriptionHandle;
  /** Chat target status is busy (streaming/refreshing) — a send will queue, not run immediately. */
  targetBusy: boolean;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  handleSend: () => void;
  handleCancelTranscription: () => void;
  /** Drops the persisted dictation draft when transcript is moved to input or sent. */
  clearDraft: () => void;
  onKeyboard: () => void;
  onVoice: () => void;
  onStopDictation: () => void;
  onVoiceSegmentSend: (text: string) => void;
  voicePaused: boolean;
  onUnpause: () => void;
  hideMobile?: boolean;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLTextAreaElement>) => void;
  onAttachFiles: () => void;
  /** Ingest images into the composer (shared with paste/drop) — feeds the "Send screenshot…" item. */
  addImageFiles: (files: File[]) => Promise<number>;
  /** Enter capture mode (full-screen viewfinder / mic). */
  onEnterCapture: () => void;
  /** Whether capture is offered (suppressed for native shells, like the mic). */
  captureEnabled: boolean;
  /** When set, the capture affordance renders disabled with this tooltip (X1). */
  captureDisabledReason?: string | undefined;
  /** Open the full-screen bulk file-upload overlay. */
  onUploadFiles: () => void;
  /** When set, the "Upload files…" item renders disabled with this reason (no chat session id yet). */
  uploadFilesDisabledReason?: string | undefined;
  narrationEnabled: boolean;
}) {
  // Subscribing read of the composer text — this is the component a keystroke
  // re-renders (and its small button-bar subtree), not the chat at large.
  const input = useInputValue();
  const setInput = useInputStore().set;
  return (
    <section aria-label="Compose message" className={`flex-shrink-0 border-t border-warm-300 bg-gradient-to-r from-warm-100 via-warm-100 to-warm-200 px-3 py-2${hideMobile ? " hidden sm:block" : ""}`}>
      <div className="relative flex items-center gap-2">
        {/* Floats above the voice button at the bar's right edge — anchored
            here (not in the textarea rows) so it rides the record/stop
            control on both desktop and mobile. */}
        {isTranscribing ? (
          <MicOverlay
            hasText={joinTranscript(input, transcription.transcript).trim().length > 0}
            degraded={transcription.state === "reconnecting"}
          />
        ) : null}
        {/* Add menu: capture mode, attach file, share location. */}
        <Dropdown
          align="left"
          vertical="above"
          width="w-44"
          trigger={({ toggle, ariaProps }) => (
            <button
              type="button"
              onClick={toggle}
              className={`${CIRCLE_BTN} bg-warm-300 text-warm-700 hover:bg-warm-400 active:bg-warm-500`}
              title="Add"
              aria-label="Add"
              {...ariaProps}
            >
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          )}
        >
          {captureEnabled ? (
            <MenuItem onClick={onEnterCapture} disabled={captureDisabledReason !== undefined}>
              {captureDisabledReason !== undefined ? `Capture… (${captureDisabledReason.toLowerCase()})` : "Capture…"}
            </MenuItem>
          ) : null}
          <MenuItem onClick={onAttachFiles}>Attach file…</MenuItem>
          <MenuItem onClick={onUploadFiles} disabled={uploadFilesDisabledReason !== undefined}>
            {uploadFilesDisabledReason !== undefined ? `Upload files… (${uploadFilesDisabledReason.toLowerCase()})` : "Upload files…"}
          </MenuItem>
          <ScreenshotMenuItem addImageFiles={addImageFiles} />
          <ShareLocationMenuItem />
        </Dropdown>

        {/* First-class capture button on the mobile row (room the desktop
            textarea occupies). Desktop reaches capture via the Add menu. */}
        {captureEnabled ? (
          <button
            type="button"
            onClick={onEnterCapture}
            disabled={captureDisabledReason !== undefined}
            className={`${CIRCLE_BTN} sm:hidden bg-warm-300 text-warm-700 hover:bg-warm-400 active:bg-warm-500 disabled:opacity-50 disabled:cursor-not-allowed`}
            title={captureDisabledReason ?? "Capture"}
            aria-label="Capture"
          >
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <circle cx="12" cy="13" r="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}

        <DesktopComposerRow
          textareaRef={textareaRef}
          input={input}
          setInput={setInput}
          isTranscribing={isTranscribing}
          transcription={transcription}
          targetBusy={targetBusy}
          handleKeyDown={handleKeyDown}
          handleSend={handleSend}
          handleCancelTranscription={handleCancelTranscription}
          clearDraft={clearDraft}
          onStopDictation={onStopDictation}
          onVoiceSegmentSend={onVoiceSegmentSend}
          onPaste={onPaste}
          onDrop={onDrop}
        />

        {/* Mobile: spacer */}
        <div className="flex-1 sm:hidden" />

        {/* Mobile-only: keyboard button */}
        <button
          onClick={onKeyboard}
          className={`${CIRCLE_BTN} sm:hidden bg-warm-300 text-warm-700 hover:bg-warm-400 active:bg-warm-500`}
          title="Type a message"
        >
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="2" y="6" width="20" height="12" rx="2" strokeWidth={2} />
            <path strokeLinecap="round" strokeWidth={2} d="M6 10h1M10 10h1M14 10h1M18 10h1M8 14h8" />
          </svg>
        </button>

        <VoiceToggleButton
          voicePaused={voicePaused}
          isTranscribing={isTranscribing}
          narrationEnabled={narrationEnabled}
          transcription={transcription}
          onStopDictation={onStopDictation}
          setInput={setInput}
          clearDraft={clearDraft}
          onUnpause={onUnpause}
          onVoice={onVoice}
        />
      </div>
    </section>
  );
}

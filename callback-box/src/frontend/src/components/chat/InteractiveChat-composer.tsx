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
  textareaRef, input, setInput, isTranscribing, transcription,
  handleKeyDown, handleSend, handleCancelTranscription, clearDraft,
  onStopDictation, onVoiceSegmentSend, onPaste, onDrop,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  isTranscribing: boolean;
  transcription: TranscriptionHandle;
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
          title="Send"
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
  textareaRef, isTranscribing, transcription,
  handleKeyDown, handleSend, handleCancelTranscription, clearDraft,
  onKeyboard, onVoice, speechPlaying, onStopSpeech,
  isStreaming, onInterrupt, onStopDictation, onVoiceSegmentSend,
  voicePaused, onUnpause, hideMobile,
  onPaste, onDrop, onAttachFiles, narrationEnabled,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  isTranscribing: boolean;
  transcription: TranscriptionHandle;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  handleSend: () => void;
  handleCancelTranscription: () => void;
  /** Drops the persisted dictation draft when transcript is moved to input or sent. */
  clearDraft: () => void;
  onKeyboard: () => void;
  onVoice: () => void;
  speechPlaying: boolean;
  onStopSpeech: () => void;
  isStreaming: boolean;
  onInterrupt: () => void;
  onStopDictation: () => void;
  onVoiceSegmentSend: (text: string) => void;
  voicePaused: boolean;
  onUnpause: () => void;
  hideMobile?: boolean;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLTextAreaElement>) => void;
  onAttachFiles: () => void;
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
        {/* Add menu: camera (coming soon), attach file. Capture lives here in the future. */}
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
          <MenuItem onClick={() => {}} disabled>Camera (coming soon)</MenuItem>
          <MenuItem onClick={onAttachFiles}>Attach file…</MenuItem>
          <ShareLocationMenuItem />
        </Dropdown>

        <DesktopComposerRow
          textareaRef={textareaRef}
          input={input}
          setInput={setInput}
          isTranscribing={isTranscribing}
          transcription={transcription}
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

        {/* Shared: conditional stop buttons */}
        {speechPlaying ? (
          <button
            onClick={onStopSpeech}
            className={`${CIRCLE_BTN} bg-danger-100 text-danger hover:bg-danger-100 active:bg-danger-light`}
            title="Stop speaking"
          >
            {/* Speaker-x (audio), not the stop circle — that one stops the agent. */}
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5 6 9H3v6h3l5 4V5zM17 9l4 6m0-6-4 6" />
            </svg>
          </button>
        ) : null}
        {isStreaming ? (
          <button
            onClick={onInterrupt}
            className={`${CIRCLE_BTN} bg-danger-100 text-danger hover:bg-danger-100 active:bg-danger-light`}
            title="Stop agent"
          >
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
            </svg>
          </button>
        ) : null}

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

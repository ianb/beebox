/**
 * The unified composer button bar for InteractiveChat: button bar + inline
 * textarea on desktop, button bar only on mobile. The mobile-only textarea
 * row that drops below the bar lives in InteractiveChat-mobile-row.tsx.
 * Presentational — the transcription handle, input setters, and send
 * callbacks come in as props.
 */

import TextareaAutosize from "react-textarea-autosize";
import { MicrophoneIcon, RecordingIndicator } from "../VoiceRecorder";
import { unlockAudioContext } from "../../lib/audio-context";
import { Dropdown, MenuItem } from "../ui/Dropdown";
import { NarrationMicIcon } from "./InteractiveChat-controls";
import { composerTextareaClasses, joinTranscript, localTime } from "./InteractiveChat-helpers";

export interface TranscriptionHandle {
  transcript: string;
  start: () => void;
  stop: () => Promise<string>;
  cancel: () => void;
}

const CIRCLE_BTN = "flex items-center justify-center w-14 h-14 rounded-full flex-shrink-0";

const SEND_PATH = "M5 10l7-7m0 0l7 7m-7-7v18";
const STOP_CIRCLE_PATHS = (
  <>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
  </>
);

/**
 * Desktop-only inline textarea plus its trailing send / transcription-action
 * buttons. Hidden below the `sm` breakpoint.
 */
function DesktopComposerRow({
  textareaRef, input, setInput, isTranscribing, transcription,
  handleKeyDown, handleSend, handleCancelTranscription, clearDraft,
  turnTakingRef, doSend, zoomedViewAttr, timePassedAttr, onPaste, onDrop,
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
  turnTakingRef: React.MutableRefObject<boolean>;
  doSend: (wrapped: string) => void;
  zoomedViewAttr: () => string;
  timePassedAttr: () => string;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <div className="hidden sm:flex flex-1 items-center gap-2 min-w-0">
      {isTranscribing ? (
        <div className="flex-shrink-0 self-center">
          <RecordingIndicator />
        </div>
      ) : null}
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
              turnTakingRef.current = false;
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
              if (text) doSend(`<speech local-time="${localTime()}"${zoomedViewAttr()}${timePassedAttr()}>${text}</speech>`);
              setInput("");
              // Segment committed — drop the persisted dictation draft.
              clearDraft();
            }}
            className={`${CIRCLE_BTN} bg-accent text-white hover:bg-accent-dark`}
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
 * The trailing voice button — toggles recording on/off and resumes after a
 * TTS-induced pause, swapping its icon to reflect the current voice state.
 */
function VoiceToggleButton({
  voicePaused, isTranscribing, narrationEnabled, transcription, turnTakingRef, setInput, clearDraft, onUnpause, onVoice,
}: {
  voicePaused: boolean;
  isTranscribing: boolean;
  narrationEnabled: boolean;
  transcription: TranscriptionHandle;
  turnTakingRef: React.MutableRefObject<boolean>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  clearDraft: () => void;
  onUnpause: () => void;
  onVoice: () => void;
}) {
  return (
    <button
      onClick={() => {
        if (voicePaused) {
          onUnpause();
        } else if (isTranscribing) {
          // Stop recording, preserve transcript into input for editing. It's
          // now editable typed text, not voice — drop the dictation draft so
          // it can't resurface later as a phantom "Recovered dictation".
          turnTakingRef.current = false;
          const text = transcription.transcript;
          transcription.cancel();
          if (text) setInput((existing) => (existing ? existing + " " + text : text));
          clearDraft();
        } else {
          unlockAudioContext();
          onVoice();
        }
      }}
      className={`${CIRCLE_BTN} ${voicePaused ? "bg-primary/50 text-white animate-pulse" : isTranscribing ? "bg-danger text-white hover:bg-danger-dark active:opacity-80" : "bg-primary text-white hover:bg-primary-dark active:opacity-80"}`}
      title={voicePaused ? "Resume recording (stops speech)" : isTranscribing ? "Stop recording" : narrationEnabled ? "Voice input (narration mode)" : "Voice input"}
    >
      {voicePaused ? (
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ) : isTranscribing ? (
        <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      ) : narrationEnabled ? (
        <NarrationMicIcon className="w-7 h-7" />
      ) : (
        <MicrophoneIcon className="w-7 h-7" />
      )}
    </button>
  );
}

/**
 * Unified input area: button bar + inline textarea on desktop, button bar only on mobile.
 * On desktop (sm:+): [capture] [camera] [textarea...] [send] [stop] [voice] in one row.
 * On mobile: [capture] [camera] [spacer] [stop] [keyboard] [voice] — textarea appears below when typing.
 */
export function ChatInputArea({
  textareaRef, input, setInput, isTranscribing, transcription,
  handleKeyDown, handleSend, handleCancelTranscription, clearDraft,
  onKeyboard, onVoice, speechPlaying, onStopSpeech,
  isStreaming, onInterrupt, turnTakingRef, doSend, zoomedViewAttr, timePassedAttr,
  voicePaused, onUnpause, hideMobile,
  onPaste, onDrop, onAttachFiles, narrationEnabled,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
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
  turnTakingRef: React.MutableRefObject<boolean>;
  doSend: (wrapped: string) => void;
  zoomedViewAttr: () => string;
  timePassedAttr: () => string;
  voicePaused: boolean;
  onUnpause: () => void;
  hideMobile?: boolean;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLTextAreaElement>) => void;
  onAttachFiles: () => void;
  narrationEnabled: boolean;
}) {
  return (
    <section aria-label="Compose message" className={`flex-shrink-0 border-t border-warm-300 bg-gradient-to-r from-warm-100 via-warm-100 to-warm-200 px-3 py-2${hideMobile ? " hidden sm:block" : ""}`}>
      <div className="flex items-center gap-2">
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
          turnTakingRef={turnTakingRef}
          doSend={doSend}
          zoomedViewAttr={zoomedViewAttr}
          timePassedAttr={timePassedAttr}
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
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {STOP_CIRCLE_PATHS}
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
              {STOP_CIRCLE_PATHS}
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
          turnTakingRef={turnTakingRef}
          setInput={setInput}
          clearDraft={clearDraft}
          onUnpause={onUnpause}
          onVoice={onVoice}
        />
      </div>
    </section>
  );
}

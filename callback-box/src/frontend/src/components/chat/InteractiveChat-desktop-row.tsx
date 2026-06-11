/**
 * Desktop-only inline textarea plus its trailing send / transcription-action
 * buttons, shown inside the composer button bar at the `sm` breakpoint and
 * up. The mobile counterpart lives in InteractiveChat-mobile-row.tsx.
 * Presentational — the transcription handle, input setters, and send
 * callbacks come in as props.
 */

import TextareaAutosize from "react-textarea-autosize";
import { RecordingIndicator } from "../VoiceRecorder";
import { KeywordHint } from "./KeywordHint";
import {
  CIRCLE_BTN, SEND_PATH, composerTextareaClasses, joinTranscript, localTime,
  type TranscriptionHandle,
} from "./InteractiveChat-helpers";

export function DesktopComposerRow({
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
    <div className="relative hidden sm:flex flex-1 items-center gap-2 min-w-0">
      {isTranscribing ? (
        <>
          <KeywordHint />
          <div className="flex-shrink-0 self-center">
            <RecordingIndicator degraded={transcription.state === "reconnecting"} />
          </div>
        </>
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

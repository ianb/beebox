/**
 * Mobile-only textarea row shown below InteractiveChat's button bar when the
 * user is typing or while transcription is in flight. Presentational — the
 * transcription handle, input setters, and send callbacks come in as props.
 */

import { useRef } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { RecordingIndicator } from "../VoiceRecorder";
import { useTranscriptAutoscroll } from "../../hooks/useTranscriptAutoscroll";
import { MicOverlay } from "./MicOverlay";
import { composerTextareaClasses, joinTranscript, localTime } from "./InteractiveChat-helpers";
import type { TranscriptionHandle } from "./InteractiveChat-composer";

/**
 * Mobile-only textarea row shown below the button bar when typing or transcribing.
 */
export function MobileTextareaRow({
  input, setInput, isTranscribing, transcription,
  handleSend, handleCancelTranscription, clearDraft,
  onStopDictation, doSend, zoomedViewAttr, timePassedAttr,
  onPaste, onDrop,
}: {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  isTranscribing: boolean;
  transcription: TranscriptionHandle;
  handleSend: () => void;
  handleCancelTranscription: () => void;
  /** Drops the persisted dictation draft when transcript is moved to input or sent. */
  clearDraft: () => void;
  onStopDictation: () => void;
  doSend: (wrapped: string) => void;
  zoomedViewAttr: () => string;
  timePassedAttr: () => string;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLTextAreaElement>) => void;
}) {
  const circleBtn = "flex items-center justify-center w-12 h-12 rounded-full flex-shrink-0";

  // This textarea is separate from the desktop composer's (which has its own
  // ref + autoscroll wired in useChatActions), so it needs its own pinning.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useTranscriptAutoscroll({ isTranscribing, textareaRef, transcriptTick: transcription.transcript });

  return (
    <div className="relative flex gap-2 items-center">
      {isTranscribing ? (
        <>
          <MicOverlay hasText={joinTranscript(input, transcription.transcript).trim().length > 0} />
          <div className="flex-shrink-0 self-center">
            <RecordingIndicator degraded={transcription.state === "reconnecting"} />
          </div>
        </>
      ) : null}
      <TextareaAutosize
        ref={textareaRef}
        value={isTranscribing ? joinTranscript(input, transcription.transcript) : input}
        onChange={(e) => { if (!isTranscribing) setInput(e.target.value); }}
        onPaste={onPaste}
        onDrop={onDrop}
        readOnly={isTranscribing}
        enterKeyHint="enter"
        placeholder={isTranscribing ? "Listening..." : "Type or paste an image..."}
        className={composerTextareaClasses({ mobile: true, isTranscribing })}
        minRows={2}
        maxRows={8}
        autoFocus
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
              if (text) setInput((existing) => (existing ? existing + " " + text : text));
              transcription.stop();
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
            onClick={async () => {
              const finalText = await transcription.stop();
              // Continue from any prior composer text so it isn't dropped.
              const text = joinTranscript(input, finalText).trim();
              if (text) doSend(`<speech local-time="${localTime()}"${zoomedViewAttr()}${timePassedAttr()}>${text}</speech>`);
              setInput("");
              // Segment committed — drop the persisted dictation draft.
              clearDraft();
            }}
            disabled={!joinTranscript(input, transcription.transcript).trim()}
            className={`${circleBtn} bg-accent text-white hover:bg-accent-dark disabled:bg-info-muted disabled:text-white/70 disabled:cursor-not-allowed`}
            title="Send"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </button>
        </>
      ) : (
        <button
          onClick={handleSend}
          disabled={!input.trim()}
          className={`${circleBtn} bg-accent text-white hover:bg-accent-dark disabled:bg-info-muted disabled:text-white/70 disabled:cursor-not-allowed`}
          title="Send"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </button>
      )}
    </div>
  );
}

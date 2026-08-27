/**
 * Mobile-only textarea row shown below InteractiveChat's button bar when the
 * user is typing or while transcription is in flight. Presentational — the
 * transcription handle, input setters, and send callbacks come in as props.
 */

import { useRef } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { useTranscriptAutoscroll } from "../../hooks/useTranscriptAutoscroll";
import { composerTextareaClasses, joinTranscript, routeComposerSend, spokenTextStart, type VoiceSegmentSend } from "./InteractiveChat-helpers";
import { useInputValue, useInputStore } from "./input-store";
import { ComposerSendButton, type TranscriptionHandle } from "./InteractiveChat-composer";

/**
 * Mobile-only textarea row shown below the button bar when typing or transcribing.
 */
export function MobileTextareaRow({
  isTranscribing, transcription, targetBusy,
  handleSend, handleCancelTranscription, clearDraft,
  onStopDictation, onVoiceSegmentSend,
  onPaste, onDrop,
}: {
  isTranscribing: boolean;
  transcription: TranscriptionHandle;
  /** Chat target status is busy (streaming/refreshing) — a send will queue, not run immediately. */
  targetBusy: boolean;
  handleSend: () => void;
  handleCancelTranscription: () => void;
  /** Drops the persisted dictation draft when transcript is moved to input or sent. */
  clearDraft: () => void;
  onStopDictation: () => void;
  onVoiceSegmentSend: VoiceSegmentSend;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLTextAreaElement>) => void;
}) {
  const input = useInputValue();
  const setInput = useInputStore().set;

  // This textarea is separate from the desktop composer's (which has its own
  // ref + autoscroll wired in useChatActions), so it needs its own pinning.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useTranscriptAutoscroll({ isTranscribing, textareaRef, transcriptTick: transcription.transcript });

  return (
    <div className="flex gap-2 items-center">
      <TextareaAutosize
        // `-mobile`, not the desktop row's address: this row and the button
        // bar's row can be in the DOM at the same time (the bar stays mounted
        // under `hidden sm:block` while typing), so they cannot share one id.
        // Recorded in docs/plans/agent-points-at-ui.md, Track 1.
        id="cb-composer-input-mobile"
        ref={textareaRef}
        value={isTranscribing ? joinTranscript(input, transcription.transcript) : input}
        onChange={(e) => { if (!isTranscribing) setInput(e.target.value); }}
        onPaste={onPaste}
        onDrop={onDrop}
        readOnly={isTranscribing}
        enterKeyHint="enter"
        placeholder={isTranscribing ? "Listening..." : "Type a message..."}
        className={composerTextareaClasses({ mobile: true, isTranscribing })}
        minRows={2}
        maxRows={8}
        autoFocus
      />
      {isTranscribing ? (
        <>
          <button
            id="cb-composer-dictation-cancel-mobile"
            onClick={handleCancelTranscription}
            className="p-2 text-danger hover:text-danger-dark rounded-lg hover:bg-danger-50 flex-shrink-0"
            title="Cancel (Esc)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <button
            id="cb-composer-dictation-edit-mobile"
            onClick={() => {
              onStopDictation();
              const text = transcription.transcript;
              if (text) setInput((existing) => (existing ? existing + " " + text : text));
              // stop() only ever resolves (state-machine bookkeeping, no I/O
              // that can fail) -- its resolved transcript isn't needed here
              // since we already read `transcription.transcript` above.
              void transcription.stop();
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
        </>
      ) : null}
      {/* One send control for both branches, same as the button bar's row —
          see ComposerSendButton. */}
      <ComposerSendButton
        id="cb-composer-send-mobile"
        size="md"
        onClick={() => {
          routeComposerSend({
            isTranscribing,
            submitSegment: () => transcription.submitSegment({ closeMic: true }),
            sendTyped: handleSend,
            sendSettledVoice: () => {
              void (async () => {
                const { text: finalText, words } = await transcription.stop();
                const text = joinTranscript(input, finalText).trim();
                if (text) onVoiceSegmentSend(text, { words, spokenStart: spokenTextStart(input) });
                setInput("");
                clearDraft();
              })();
            },
          });
        }}
        disabled={!(isTranscribing ? joinTranscript(input, transcription.transcript) : input).trim()}
        title={isTranscribing || !targetBusy ? "Send" : "Queue message (agent is busy)"}
      />
    </div>
  );
}

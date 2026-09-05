/**
 * The unified composer button bar for InteractiveChat: button bar + inline
 * textarea on desktop, button bar only on mobile. The mobile-only textarea
 * row that drops below the bar lives in InteractiveChat-mobile-row.tsx.
 * Presentational — the transcription handle, input setters, and send
 * callbacks come in as props.
 */

import TextareaAutosize from "react-textarea-autosize";
import { Dropdown } from "../ui/Dropdown";
import { MenuItem } from "../ui/dropdown-menu-item";
import { ShareLocationMenuItem } from "./ShareLocationMenuItem";
import { ScreenshotMenuItem } from "./ScreenshotMenuItem";
import { VoiceToggleButton } from "./InteractiveChat-voice-button";
import { MicOverlay } from "./MicOverlay";
import { composerTextareaClasses, joinTranscript, routeComposerSend, spokenTextStart, type VoiceSegmentSend } from "./InteractiveChat-helpers";
import { useInputValue, useInputStore } from "./input-store";
import type { AddFiles } from "./InteractiveChat-attachments";
import type { TranscriptionState } from "../../hooks/useRealtimeTranscription";
import type { FinalWord } from "../../machines/transcription-events";

export interface TranscriptionHandle {
  state: TranscriptionState;
  transcript: string;
  /** Words backing `transcript`'s finalized portion (Fix D) — null when none captured. */
  finalWords: readonly FinalWord[] | null;
  start: () => void;
  stop: () => Promise<{ text: string; words: readonly FinalWord[] | null }>;
  /**
   * Manual stop-and-send routed through the finalize-and-retain path (see
   * useRealtimeTranscription). HQ transcription is optional and happens
   * later. False = the segment already settled, so the caller falls back.
   */
  submitSegment: (opts: { closeMic: boolean }) => boolean;
  cancel: () => void;
}

const CIRCLE_BTN = "flex items-center justify-center w-14 h-14 rounded-full flex-shrink-0";

const SEND_PATH = "M5 10l7-7m0 0l7 7m-7-7v18";

/**
 * The composer's trailing send button, shared by the desktop and mobile rows.
 *
 * One `id` covers both of a row's branches — the dictation segment-send and the
 * plain send are the same role in the interface and are never in the DOM at
 * once, which is exactly the case an authored address is allowed to span
 * (docs/plans/agent-points-at-ui.md, "an id names a role in the interface, not
 * a component"). The two *rows* are a different story: they can coexist in the
 * DOM, so the mobile row passes its own address.
 */
export function ComposerSendButton({
  id, onClick, disabled, title, size,
}: {
  id: string;
  onClick: () => void;
  disabled: boolean;
  title: string;
  /** `lg` on the button bar (matches the circle controls), `md` on the mobile drop-up row. */
  size: "lg" | "md";
}) {
  const dim = size === "lg" ? "w-14 h-14" : "w-12 h-12";
  return (
    <button
      id={id}
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center ${dim} rounded-full flex-shrink-0 bg-accent text-white hover:bg-accent-dark disabled:bg-info-muted disabled:text-white/70 disabled:cursor-not-allowed`}
      title={title}
    >
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={SEND_PATH} />
      </svg>
    </button>
  );
}

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
  onVoiceSegmentSend: VoiceSegmentSend;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <div className="hidden sm:flex flex-1 items-center gap-2 min-w-0">
      <TextareaAutosize
        id="bbx-composer-input"
        ref={textareaRef}
        autoFocus
        enterKeyHint="send"
        value={isTranscribing ? joinTranscript(input, transcription.transcript) : input}
        onChange={(e) => { if (!isTranscribing) setInput(e.target.value); }}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        onDrop={onDrop}
        readOnly={isTranscribing}
        placeholder={isTranscribing ? "Listening..." : "Type a message..."}
        className={composerTextareaClasses({ mobile: false, isTranscribing })}
        minRows={1}
        maxRows={8}
      />
      {isTranscribing ? (
        <>
          <button
            id="bbx-composer-dictation-cancel"
            onClick={handleCancelTranscription}
            className="p-2 text-danger hover:text-danger-dark rounded-lg hover:bg-danger-50 flex-shrink-0"
            title="Cancel (Esc)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <button
            id="bbx-composer-dictation-edit"
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
        </>
      ) : null}
      {/* One send control, one address: which message it commits depends on
          whether dictation is in flight, but the role — and the id — is the
          same either way, so it renders outside the branch. */}
      <ComposerSendButton
        id="bbx-composer-send"
        size="lg"
        onClick={() => {
          routeComposerSend({
            isTranscribing,
            // Finalization produces the retained audio Blob. HQ mode is an
            // independent later choice inside runKeywordSend.
            submitSegment: () => transcription.submitSegment({ closeMic: true }),
            sendTyped: handleSend,
            sendSettledVoice: () => {
              const text = joinTranscript(input, transcription.transcript).trim();
              const words = transcription.finalWords;
              transcription.cancel();
              if (text) onVoiceSegmentSend(text, { words, spokenStart: spokenTextStart(input) });
              setInput("");
              clearDraft();
            },
          });
        }}
        disabled={!(isTranscribing ? joinTranscript(input, transcription.transcript) : input).trim()}
        title={isTranscribing || !targetBusy ? "Send" : "Queue message (still thinking)"}
      />
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
  onPaste, onDrop, onAddFiles, addFiles, onEnterCapture, captureEnabled, captureDisabledReason,
  narrationEnabled,
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
  onVoiceSegmentSend: VoiceSegmentSend;
  voicePaused: boolean;
  onUnpause: () => void;
  hideMobile?: boolean;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLTextAreaElement>) => void;
  /** Open the file picker behind the Add menu's one file entry. */
  onAddFiles: () => void;
  /** Ingest files into the composer (shared with picker/paste/drop) — feeds the "Send screenshot…" item. */
  addFiles: AddFiles;
  /** Enter capture mode (full-screen viewfinder / mic). */
  onEnterCapture: () => void;
  /** Whether capture is offered (suppressed for native shells, like the mic). */
  captureEnabled: boolean;
  /** When set, the capture affordance renders disabled with this tooltip (X1). */
  captureDisabledReason?: string | undefined;
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
        {/* Add menu: capture mode, add files, screenshot, share location. */}
        <Dropdown
          align="left"
          vertical="above"
          // Wide enough that the "(send a message first)" disabled reasons
          // stay on one line — at w-44 they wrapped mid-phrase and the menu
          // read as squashed (field-test run 2 visual flag).
          width="w-72"
          trigger={({ toggle, ariaProps }) => (
            <button
              type="button"
              id="bbx-composer-add"
              data-bbx-reveal
              // The menu's contents are the whole point of the description —
              // the scan cannot see inside a closed menu.
              data-bbx-does={`opens the attach menu — ${captureEnabled ? "capture, " : ""}attach file, upload files, send screenshot, share location`}
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
            <MenuItem id="bbx-composer-add-capture" onClick={onEnterCapture} disabled={captureDisabledReason !== undefined}>
              {captureDisabledReason !== undefined ? `Capture… (${captureDisabledReason.toLowerCase()})` : "Capture…"}
            </MenuItem>
          ) : null}
          {/* One file entry: where the files land (inline vs. bulk batch) is
              decided by `file-routing.ts`, not by the user picking a menu item
              (issues/features/2026-08-03-attach-vs-upload-menu-confusing.md). */}
          <MenuItem id="bbx-composer-add-files" onClick={onAddFiles}>Add files…</MenuItem>
          <ScreenshotMenuItem addFiles={addFiles} />
          <ShareLocationMenuItem />
        </Dropdown>

        {/* First-class capture button on the mobile row (room the desktop
            textarea occupies). Desktop reaches capture via the Add menu. */}
        {captureEnabled ? (
          <button
            type="button"
            id="bbx-composer-capture"
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
          id="bbx-composer-keyboard"
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

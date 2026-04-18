/**
 * InteractiveChat - the live chat UI for the box's conversational assistant.
 *
 * Streams messages from the backend ChatSession via SSE.
 * User input is wrapped in <typed> tags before sending.
 * User messages are right-aligned dark bubbles; assistant uses markdown.
 *
 * Rendered by ChatPage when no `?session=<id>` query param is present
 * (a present session id switches to a read-only SessionViewer instead).
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
// search params read via window.location — avoids coupling to route definition
import { useSSRMachine } from "../../hooks/useSSRMachine";
import TextareaAutosize from "react-textarea-autosize";
import { getApiBase, getEventSourceBase, getChatHistory, type SessionEntry, type SessionContentBlock, type ChatImageAttachment } from "../../api";
import { AttachmentPanel, type AttachmentItem } from "../ChatAttachments";
import { extractImageFiles, processImageBlob } from "../../lib/image-paste";
import { useRealtimeTranscription } from "../../hooks/useRealtimeTranscription";
import { useSpeechPlayback } from "../../hooks/useSpeechPlayback";
import { parseAllSpeechTags, VALID_VOICES, type SpeechSegment } from "../../lib/speech-parsing";
import { getTTSClient } from "../../lib/tts-client";
import { unlockAudioContext } from "../../lib/audio-context";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Grid } from "ldrs/react";
import "ldrs/react/Grid.css";
import { sendSound, tick, recordingStart, alarm } from "../../lib/earcons";
import { MicrophoneIcon, RecordingIndicator } from "../VoiceRecorder";
import { DebugLogPanel } from "../DebugLog";
import { chatMachine } from "../../machines/chatMachine.js";
import { UserMessage, AssistantMessage, CompactionMessage, SelfNoteMessage, ToolList, MarkdownContent, groupMessages, type OnZoomView } from "../ChatMessages";
import { FileView } from "../FileView";
import { Dropdown, MenuItem, MenuDivider } from "../ui/Dropdown";
import { CloseButton } from "../ui/CloseButton";
import { ExternalIconLink } from "../ui/ExternalIconLink";
import { serializeViewUrl, type ViewTarget } from "../../lib/view-url";
import { SessionListButton } from "../SessionViewer";
import { RecentFilesButton } from "../RecentFilesButton";
import { useSSE, type SSEEvent } from "../../hooks/useSSE";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useParams } from "@tanstack/react-router";
import { href } from "../../lib/routing";
import type { ChatSchedule } from "../../../../core/chat-schedules";

/**
 * Countdown pill showing time remaining for an active schedule.
 */
function SchedulePill({ schedule, onCancel, onFired }: { schedule: ChatSchedule; onCancel: () => void; onFired?: () => void }) {
  const [remaining, setRemaining] = useState("");
  const firedRef = useRef(false);

  useEffect(() => {
    const update = () => {
      const ms = new Date(schedule.firesAt).getTime() - Date.now();
      if (ms <= 0) {
        setRemaining("now");
        if (!firedRef.current) {
          firedRef.current = true;
          onFired?.();
        }
        return;
      }
      const totalSec = Math.ceil(ms / 1000);
      if (totalSec >= 3600) {
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        setRemaining(m > 0 ? `${h}h ${m}m` : `${h}h`);
      } else if (totalSec >= 60) {
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        setRemaining(s > 0 ? `${m}m ${s}s` : `${m}m`);
      } else {
        setRemaining(`${totalSec}s`);
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [schedule.firesAt, onFired]);

  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/15 text-accent-dark text-xs font-medium border border-accent/30">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {schedule.label}: {remaining}
      {schedule.alarm ? " 🔔" : null}
      <button
        onClick={onCancel}
        className="ml-0.5 text-accent-dark/60 hover:text-accent-dark"
        title="Cancel schedule"
      >
        {"\u00D7"}
      </button>
    </span>
  );
}

/**
 * Format the current local time as HH:MM for the typed tag.
 */
function localTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/**
 * Format a millisecond gap as "Xh" or "XdYh" (hours omitted when zero).
 * Returns null when the gap is under 12 hours — callers should omit the attribute then.
 */
function formatTimePassed(ms: number): string | null {
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  if (ms < TWELVE_HOURS) return null;
  const totalHours = Math.floor(ms / (60 * 60 * 1000));
  if (totalHours < 24) return `${totalHours}h`;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days}d${hours}h` : `${days}d`;
}

function NewSessionButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="p-1.5 rounded hover:bg-white/20 text-white/80 hover:text-white"
      title="New Session"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
    </button>
  );
}

/**
 * Debug dropdown menu for chat controls.
 */
function ChatDebugMenu({
  onStopProcess,
  sessionId,
  running,
  busy,
  debugView,
  onToggleDebugView,
  showDebugLog,
  onToggleDebugLog,
}: {
  onStopProcess: () => void;
  sessionId: string | null;
  running: boolean;
  busy: boolean;
  debugView: boolean;
  onToggleDebugView: () => void;
  showDebugLog: boolean;
  onToggleDebugLog: () => void;
}) {
  return (
    <Dropdown
      align="right"
      width="w-56"
      trigger={({ toggle, ariaProps }) => (
        <button
          type="button"
          onClick={toggle}
          className="p-1.5 rounded hover:bg-white/20 text-white/80 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          title="Debug controls"
          aria-label="Debug controls"
          {...ariaProps}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
          </svg>
        </button>
      )}
    >
      <MenuItem onClick={onStopProcess} disabled={!running}>Stop Process</MenuItem>
      <MenuDivider />
      <MenuItem onClick={onToggleDebugView}>{debugView ? "\u2713 " : ""}Debug View</MenuItem>
      <MenuItem onClick={onToggleDebugLog}>{showDebugLog ? "\u2713 " : ""}Debug Log</MenuItem>
      <MenuDivider />
      <div className="px-3 py-1.5 text-xs text-warm-500">
        <div>Session: {sessionId ? sessionId.slice(0, 12) + "..." : "none"}</div>
        <div>Process: {running ? (busy ? "busy" : "idle") : "stopped"}</div>
      </div>
    </Dropdown>
  );
}

/**
 * Companion view panel shown alongside chat when a view is zoomed.
 */
function CompanionViewPanel({ view, onClose }: { view: { target: ViewTarget; label: string }; onClose: () => void }) {
  const { boxSlug } = useParams({ strict: false });
  const browseHref = href(`/${boxSlug}/browse/${view.target.path}`);
  return (
    <div className="h-[40vh] md:h-full md:w-1/2 flex-shrink-0 flex flex-col border-b md:border-b-0 md:border-r border-warm-300 bg-white">
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-warm-300 bg-warm-50">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{view.label}</div>
          <div className="text-xs text-warm-500 truncate" title={view.target.path}>{view.target.path}</div>
        </div>
        <ExternalIconLink href={browseHref} label="Open in browse view (new tab)" size="sm" />
        <CloseButton onClick={onClose} label="Close companion view" size="sm" />
      </div>
      <div className="flex-1 overflow-auto">
        <FileView path={view.target.path} mode="companion" rendererName={view.target.viewer} />
      </div>
    </div>
  );
}

/**
 * Unified input area: button bar + inline textarea on desktop, button bar only on mobile.
 * On desktop (sm:+): [capture] [camera] [textarea...] [send] [stop] [voice] in one row.
 * On mobile: [capture] [camera] [spacer] [stop] [keyboard] [voice] — textarea appears below when typing.
 */
function ChatInputArea({
  textareaRef, input, setInput, isTranscribing, transcription,
  handleKeyDown, handleSend, handleCancelTranscription,
  onKeyboard, onVoice, speechPlaying, onStopSpeech,
  isStreaming, onInterrupt, turnTakingRef, doSend, zoomedViewAttr, timePassedAttr,
  voicePaused, onUnpause, hideMobile,
  onPaste, onDrop,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  isTranscribing: boolean;
  transcription: { transcript: string; start: () => void; stop: () => Promise<string>; cancel: () => void };
  handleKeyDown: (e: React.KeyboardEvent) => void;
  handleSend: () => void;
  handleCancelTranscription: () => void;
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
}) {
  const { boxSlug } = useParams({ strict: false });
  const captureHref = href(`/${boxSlug}/capture`);

  const circleBtn = "flex items-center justify-center w-14 h-14 rounded-full flex-shrink-0";

  return (
    <div className={`flex-shrink-0 border-t border-warm-300 bg-gradient-to-r from-warm-100 via-warm-100 to-warm-200 px-3 py-2${hideMobile ? " hidden sm:block" : ""}`}>
      <div className="flex items-center gap-2">
        {/* Left buttons */}
        <a
          href={captureHref}
          className={`${circleBtn} bg-warm-300 text-warm-700 hover:bg-warm-400 active:bg-warm-500`}
          title="Capture"
        >
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </a>
        <button
          className={`${circleBtn} bg-warm-300 text-warm-500 cursor-not-allowed opacity-50`}
          title="Camera (coming soon)"
          disabled
        >
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>

        {/* Desktop: inline textarea + send button */}
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
            value={isTranscribing ? transcription.transcript : input}
            onChange={(e) => { if (!isTranscribing) setInput(e.target.value); }}
            onKeyDown={handleKeyDown}
            onPaste={onPaste}
            onDrop={onDrop}
            disabled={isTranscribing}
            readOnly={isTranscribing}
            placeholder={isTranscribing ? "Listening..." : "Type or paste an image..."}
            className="flex-1 resize-none rounded-lg border border-warm-400 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:bg-warm-200 disabled:text-warm-600 min-w-0"
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
                  const text = transcription.transcript.trim();
                  transcription.cancel();
                  if (text) doSend(`<speech local-time="${localTime()}"${zoomedViewAttr()}${timePassedAttr()}>${text}</speech>`);
                }}
                className={`${circleBtn} bg-accent text-white hover:bg-accent-dark`}
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

        {/* Mobile: spacer */}
        <div className="flex-1 sm:hidden" />

        {/* Shared: conditional stop buttons */}
        {speechPlaying ? (
          <button
            onClick={onStopSpeech}
            className={`${circleBtn} bg-danger-100 text-danger hover:bg-danger-100 active:bg-danger-light`}
            title="Stop speaking"
          >
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
            </svg>
          </button>
        ) : null}
        {isStreaming ? (
          <button
            onClick={onInterrupt}
            className={`${circleBtn} bg-danger-100 text-danger hover:bg-danger-100 active:bg-danger-light`}
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
          className={`${circleBtn} sm:hidden bg-warm-300 text-warm-700 hover:bg-warm-400 active:bg-warm-500`}
          title="Type a message"
        >
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="2" y="6" width="20" height="12" rx="2" strokeWidth={2} />
            <path strokeLinecap="round" strokeWidth={2} d="M6 10h1M10 10h1M14 10h1M18 10h1M8 14h8" />
          </svg>
        </button>

        {/* Voice button — toggle: start recording / stop recording (preserve text) */}
        <button
          onClick={() => {
            if (voicePaused) {
              onUnpause();
            } else if (isTranscribing) {
              // Stop recording, preserve transcript into input for editing
              turnTakingRef.current = false;
              const text = transcription.transcript;
              transcription.cancel();
              if (text) setInput((existing) => (existing ? existing + " " + text : text));
            } else {
              unlockAudioContext();
              onVoice();
            }
          }}
          className={`${circleBtn} ${voicePaused ? "bg-primary/50 text-white animate-pulse" : isTranscribing ? "bg-danger text-white hover:bg-danger-dark active:opacity-80" : "bg-primary text-white hover:bg-primary-dark active:opacity-80"}`}
          title={voicePaused ? "Resume recording (stops speech)" : isTranscribing ? "Stop recording" : "Voice input"}
        >
          {voicePaused ? (
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : isTranscribing ? (
            <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <MicrophoneIcon className="w-7 h-7" />
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * Mobile-only textarea row shown below the button bar when typing or transcribing.
 */
function MobileTextareaRow({
  input, setInput, isTranscribing, transcription,
  handleKeyDown, handleSend, handleCancelTranscription,
  turnTakingRef, doSend, zoomedViewAttr, timePassedAttr,
  onPaste, onDrop,
}: {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  isTranscribing: boolean;
  transcription: { transcript: string; start: () => void; stop: () => Promise<string>; cancel: () => void };
  handleKeyDown: (e: React.KeyboardEvent) => void;
  handleSend: () => void;
  handleCancelTranscription: () => void;
  turnTakingRef: React.MutableRefObject<boolean>;
  doSend: (wrapped: string) => void;
  zoomedViewAttr: () => string;
  timePassedAttr: () => string;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLTextAreaElement>) => void;
}) {
  const circleBtn = "flex items-center justify-center w-12 h-12 rounded-full flex-shrink-0";

  return (
    <div className="flex gap-2 items-center">
      {isTranscribing ? (
        <div className="flex-shrink-0 self-center">
          <RecordingIndicator />
        </div>
      ) : null}
      <TextareaAutosize
        value={isTranscribing ? transcription.transcript : input}
        onChange={(e) => { if (!isTranscribing) setInput(e.target.value); }}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        onDrop={onDrop}
        disabled={isTranscribing}
        readOnly={isTranscribing}
        enterKeyHint="send"
        placeholder={isTranscribing ? "Listening..." : "Type or paste an image..."}
        className="flex-1 resize-none rounded-lg border border-warm-400 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:bg-warm-200 disabled:text-warm-600"
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
              turnTakingRef.current = false;
              const text = transcription.transcript;
              if (text) setInput((existing) => (existing ? existing + " " + text : text));
              transcription.stop();
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
              const text = finalText.trim();
              if (text) doSend(`<speech local-time="${localTime()}"${zoomedViewAttr()}${timePassedAttr()}>${text}</speech>`);
            }}
            className={`${circleBtn} bg-accent text-white hover:bg-accent-dark`}
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

/**
 * Streaming content being built up during a turn.
 */
function StreamingMessage({ text, onZoomView }: { text: string; onZoomView?: OnZoomView }) {
  return (
    <div className="pr-4 sm:pr-24 pl-3 sm:pl-6 py-2">
      {text ? (
        <MarkdownContent text={text} onZoomView={onZoomView} />
      ) : null}
      <div className="flex justify-center mt-6">
        <Grid size={40} color="#D4845A" speed={1.5} /> {/* coral */}
      </div>
    </div>
  );
}

/**
 * Virtualized message list using TanStack Virtual.
 * Only renders visible message groups in the DOM, with stick-to-bottom behavior.
 */
function VirtualizedMessageList({
  messages, isStreaming, streamText, streamTools,
  debugView, currentUserEmail, speechPlayback, handleStopSpeech, onZoomView, snapshot,
  totalEntries, onLoadOlder, loadingOlder, scrollToBottomTrigger,
}: {
  messages: SessionEntry[];
  isStreaming: boolean;
  streamText: string;
  streamTools: SessionContentBlock[];
  debugView: boolean;
  currentUserEmail: string | undefined;
  speechPlayback: { isPlaying: boolean };
  handleStopSpeech: () => void;
  onZoomView: OnZoomView;
  snapshot: { matches: (state: "loading" | "idle" | "streaming" | "refreshing" | "resetting") => boolean };
  totalEntries: number;
  onLoadOlder: () => void;
  loadingOlder: boolean;
  scrollToBottomTrigger: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const groups = useMemo(() => groupMessages(messages), [messages]);
  const hasOlder = totalEntries > messages.length;
  const headerCount = hasOlder ? 1 : 0;
  const itemCount = headerCount + groups.length + (snapshot.matches("streaming") ? 1 : 0);

  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => index === 0 && hasOlder ? 40 : 120,
    overscan: 5,
    getItemKey: (index) => {
      if (hasOlder && index === 0) return "load-older";
      const groupIndex = index - headerCount;
      if (groupIndex >= groups.length) return "streaming";
      return groups[groupIndex].entries[0].uuid;
    },
  });

  // Track whether user is near the bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-scroll to bottom when new messages arrive or stream updates, if user was at bottom
  const prevItemCount = useRef(itemCount);
  useEffect(() => {
    if (itemCount !== prevItemCount.current) {
      // New group added — scroll to bottom if we were there
      prevItemCount.current = itemCount;
      if (isAtBottomRef.current) {
        virtualizer.scrollToIndex(itemCount - 1, { align: "end" });
      }
    }
  }, [itemCount, virtualizer]);

  // During streaming, keep scrolling to bottom as content grows
  useEffect(() => {
    if (snapshot.matches("streaming") && isAtBottomRef.current) {
      virtualizer.scrollToIndex(itemCount - 1, { align: "end" });
    }
  }, [streamText, streamTools.length, snapshot, virtualizer, itemCount]);

  // Scroll to bottom when user sends a message (even if scrolled up)
  useEffect(() => {
    if (scrollToBottomTrigger > 0 && itemCount > 0) {
      isAtBottomRef.current = true;
      virtualizer.scrollToIndex(itemCount - 1, { align: "end" });
    }
  }, [scrollToBottomTrigger, virtualizer, itemCount]);

  // Scroll to bottom on initial mount
  useEffect(() => {
    if (itemCount > 0) {
      virtualizer.scrollToIndex(itemCount - 1, { align: "end" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 flex items-center justify-center text-warm-500 text-sm">
        Start a conversation with your box assistant.
      </div>
    );
  }

  const lastAssistantGroupIndex = groups.findLastIndex((g) => g.type === "assistant");

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const index = virtualRow.index;
          const isHeader = hasOlder && index === 0;
          const groupIndex = index - headerCount;
          const isStreamingItem = groupIndex >= groups.length;

          return (
            <div
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="py-0.5 overflow-hidden"
            >
              {isHeader ? (
                <div className="text-center py-2">
                  <button
                    onClick={onLoadOlder}
                    disabled={loadingOlder}
                    className="text-sm text-primary hover:text-primary/80 disabled:text-warm-400"
                  >
                    {loadingOlder ? "Loading..." : `Show ${totalEntries - messages.length} earlier messages`}
                  </button>
                </div>
              ) : isStreamingItem ? (
                <div>
                  <StreamingMessage text={streamText} onZoomView={onZoomView} />
                  {streamTools.length > 0 ? (
                    <div className="pl-3 sm:pl-6 pr-4 sm:pr-24 pb-2">
                      <ToolList blocks={streamTools} />
                    </div>
                  ) : null}
                </div>
              ) : (() => {
                const group = groups[groupIndex];
                if (group.type === "compaction") {
                  return <CompactionMessage entries={group.entries} />;
                } else if (group.type === "self-note") {
                  return (
                    <>
                      {group.notes.map((note, i) => (
                        <SelfNoteMessage key={i} note={note} />
                      ))}
                    </>
                  );
                } else if (group.type === "user") {
                  return <UserMessage entries={group.entries} debugView={debugView} currentUserEmail={currentUserEmail} />;
                } else {
                  return (
                    <AssistantMessage
                      entries={group.entries}
                      debugView={debugView}
                      speechPlaying={Boolean(speechPlayback.isPlaying && groupIndex === lastAssistantGroupIndex)}
                      onStopSpeech={handleStopSpeech}
                      onZoomView={onZoomView}
                    />
                  );
                }
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function InteractiveChat() {
  const [snapshot, send] = useSSRMachine(chatMachine);
  const { messages, streamText, streamTools, error, sessionId, processRunning, totalEntries } = snapshot.context;
  const isStreaming = snapshot.matches("streaming") || snapshot.matches("refreshing");
  const isLoading = snapshot.matches("loading");
  const currentUser = useCurrentUser();

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const nextAttachmentIdRef = useRef(1);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [scrollToBottomTrigger, setScrollToBottomTrigger] = useState(0);
  const [debugView, setDebugView] = useState(false);
  const [showDebugLog, setShowDebugLog] = useState(false);
  const [zoomedView, setZoomedView] = useState<{ target: ViewTarget; label: string } | null>(null);
  const [typingMode, setTypingMode] = useState(false);
  const [typingLocked, setTypingLocked] = useState(false);
  // Tracks when voice recording is paused due to TTS playback
  const [voicePaused, setVoicePaused] = useState(false);
  const voicePausedRef = useRef(false);

  const onZoomView = useCallback<OnZoomView>((view) => {
    setZoomedView(view);
  }, []);
  const [activeSchedules, setActiveSchedules] = useState<ChatSchedule[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const turnTakingRef = useRef(false);
  const transcriptionRef = useRef<{ start: () => void; cancel: () => void; state: string; transcript: string } | null>(null);
  const stopTickRef = useRef<(() => void) | null>(null);
  const prevStateRef = useRef<string>("loading");
  const speechPlayedRef = useRef(false);

  // Track machine state for use in stable callbacks
  const machineStateRef = useRef(snapshot.value);
  useEffect(() => {
    machineStateRef.current = snapshot.value;
  });

  const speechPlayback = useSpeechPlayback({
    onComplete: () => {
      // Resume recording if it was paused for TTS
      if (voicePausedRef.current) {
        voicePausedRef.current = false;
        setVoicePaused(false);
        transcriptionRef.current?.start();
      } else if (turnTakingRef.current && machineStateRef.current !== "streaming") {
        recordingStart.play();
        transcriptionRef.current?.start();
      }
    },
  });

  // Poll active schedules and listen for schedule-fired events
  const fetchSchedules = useCallback(() => {
    fetch(`${getApiBase()}/chat/schedules`)
      .then((r) => r.json())
      .then((data: { schedules: ChatSchedule[] }) => {
        setActiveSchedules(data.schedules);
      })
      .catch(() => {});
  }, []);

  // Poll schedules on mount + after each turn completes
  useEffect(() => {
    fetchSchedules();
  }, [messages, fetchSchedules]);

  // Poll for history updates when a schedule has fired (fallback for SSE)
  const prevMessageCountRef = useRef(messages.length);
  useEffect(() => {
    prevMessageCountRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    if (activeSchedules.length === 0) return;
    if (isStreaming) return; // Don't poll while user is streaming

    const checkAndPoll = () => {
      const now = Date.now();
      const anyFired = activeSchedules.some(
        (s) => new Date(s.firesAt).getTime() <= now
      );
      if (!anyFired) return;

      fetch(`${getApiBase()}/chat/history`)
        .then((r) => r.json())
        .then((data: { entries: SessionEntry[]; sessionId: string | null }) => {
          // Only update if message count actually changed
          if (data.entries.length !== prevMessageCountRef.current) {
            send({ type: "SET_MESSAGES", messages: data.entries, sessionId: data.sessionId });
          }
          fetchSchedules();
        })
        .catch(() => {});
    };

    // Start polling every 3 seconds
    const id = setInterval(checkAndPoll, 3000);
    // Also check immediately
    checkAndPoll();
    return () => clearInterval(id);
  }, [activeSchedules, send, fetchSchedules, isStreaming]);

  // Handle SSE events: schedule-fired, chat-history, chat-user-message
  useSSE(`${getEventSourceBase()}/events`, {
    onEvent: useCallback((event: SSEEvent) => {
      if (event.event === "schedule-fired") {
        const data = event.data as { label: string; alarm: boolean; announce: string | null };
        if (data.alarm) {
          alarm.play();
        }
        if (data.announce) {
          const tts = getTTSClient();
          tts.speak(data.announce).catch(() => {});
        }
        fetchSchedules();
      } else if (event.event === "chat-history") {
        const data = event.data as { entries: SessionEntry[]; sessionId: string | null };
        send({ type: "SET_MESSAGES", messages: data.entries, sessionId: data.sessionId });
        fetchSchedules();
      } else if (event.event === "chat-complete") {
        // Agent turn completed — refresh history to pick up the response.
        // This catches cases where the send SSE stream was interrupted
        // but the agent finished on the server.
        send({ type: "REFRESH" });
      } else if (event.event === "chat-user-message") {
        // Another user sent a message — add it to our view if it's not from us
        const data = event.data as { message: string; user: { email: string; name: string } | null; timestamp: string };
        if (data.user && currentUser && data.user.email !== currentUser.email) {
          send({
            type: "OTHER_USER_MESSAGE",
            message: data.message,
            userName: data.user.name,
            timestamp: data.timestamp,
          });
        }
      }
    }, [fetchSchedules, send, currentUser]),
  });

  const handleCancelSchedule = useCallback((label: string) => {
    fetch(`${getApiBase()}/chat/schedules/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    })
      .then(() => fetchSchedules())
      .catch(() => {});
  }, [fetchSchedules]);

  // Load voice config from personality on mount
  useEffect(() => {
    fetch(`${getApiBase()}/chat/voice-config`)
      .then((r) => r.json())
      .then((config: { model?: string; instructions?: string[] }) => {
        const tts = getTTSClient();
        if (config.model && (VALID_VOICES as readonly string[]).includes(config.model as typeof VALID_VOICES[number])) {
          tts.setVoiceConfig({ voice: config.model as typeof VALID_VOICES[number] });
        }
        if (config.instructions?.length) {
          tts.setVoiceConfig({ baseInstructions: config.instructions.join(" ") });
        }
      })
      .catch(() => {});
  }, []);

  // Number of speech segments already dispatched to playback from the
  // current stream. Reset when a new turn starts.
  const playedSegmentCountRef = useRef(0);

  /**
   * Dispatch a batch of new speech segments for playback, applying the
   * "suppress if user is composing voice" and "pause mic while speaking"
   * rules. Returns true if segments were queued (or intentionally
   * suppressed — i.e. handled), false otherwise.
   */
  const queueSpeechBatch = useCallback(
    (newSegments: SpeechSegment[], messageId: string): boolean => {
      if (newSegments.length === 0) return false;

      speechPlayedRef.current = true;

      // Suppress TTS if user has in-progress voice text
      const hasActiveTranscript = transcriptionRef.current &&
        transcriptionRef.current.transcript.trim().length > 0;
      if (hasActiveTranscript) {
        speechPlayback.markAsPlayed(messageId);
        return true;
      }

      // Pause recording while TTS plays
      if (transcriptionRef.current && transcriptionRef.current.state === "recording") {
        voicePausedRef.current = true;
        queueMicrotask(() => setVoicePaused(true));
        transcriptionRef.current.cancel();
      }

      speechPlayback.playSegments({ messageId, segments: newSegments });
      return true;
    },
    [speechPlayback]
  );

  // Mid-stream: play complete <speech>...</speech> segments as they arrive.
  // Counts closing </speech> tags to avoid parsing a half-received segment.
  useEffect(() => {
    if (snapshot.value !== "streaming") return;
    const text = snapshot.context.streamText;
    const closedMatches = text.match(/<\/speech>/gi);
    const closedCount = closedMatches ? closedMatches.length : 0;
    if (closedCount <= playedSegmentCountRef.current) return;

    const allSegments = parseAllSpeechTags(text);
    // parseAllSpeechTags may include a still-open tag at the end; clip to
    // the number of actual closing tags so we only dispatch fully-closed
    // segments.
    const complete = allSegments.slice(0, closedCount);
    const newSegments = complete.slice(playedSegmentCountRef.current);
    if (newSegments.length === 0) {
      // Closing tag count advanced but parser didn't surface new segments
      // (e.g. nested tags); sync the counter and move on.
      playedSegmentCountRef.current = closedCount;
      return;
    }

    const messageId = `stream-${Date.now()}-${playedSegmentCountRef.current}`;
    queueSpeechBatch(newSegments, messageId);
    playedSegmentCountRef.current = closedCount;
  }, [snapshot.value, snapshot.context.streamText, queueSpeechBatch]);

  // Handle state transitions: play any final speech, mic restart after refresh
  useEffect(() => {
    const current = snapshot.value as string;
    const prev = prevStateRef.current;
    prevStateRef.current = current;

    // Entering streaming: reset the mid-stream played counter for the new turn
    if (current === "streaming" && prev !== "streaming") {
      playedSegmentCountRef.current = 0;
    }

    // streaming → refreshing: stop tick, play any segments that didn't
    // get dispatched mid-stream (rare — parser behavior or last-tick
    // tail from the final message).
    if (current === "refreshing" && prev === "streaming") {
      if (stopTickRef.current) {
        stopTickRef.current();
        stopTickRef.current = null;
      }
      const allSegments = parseAllSpeechTags(snapshot.context.streamText);
      const remaining = allSegments.slice(playedSegmentCountRef.current);
      if (allSegments.length > 0) speechPlayedRef.current = true;
      if (remaining.length > 0) {
        queueSpeechBatch(remaining, `stream-end-${Date.now()}`);
        playedSegmentCountRef.current = allSegments.length;
      }
    }

    // refreshing → idle: restart mic for non-speech responses
    if (current === "idle" && prev === "refreshing") {
      if (!speechPlayedRef.current && turnTakingRef.current) {
        // Only restart if not already recording (might be paused/resumed by TTS logic)
        if (!voicePausedRef.current) {
          recordingStart.play();
          transcriptionRef.current?.start();
        }
      }
    }
  }, [snapshot.value, snapshot.context.streamText, queueSpeechBatch]);

  const handleLoadOlder = useCallback(() => {
    if (loadingOlder) return;
    setLoadingOlder(true);
    // Load all history up to the current start point
    const currentCount = messages.length;
    const olderCount = totalEntries - currentCount;
    const chunkSize = Math.min(olderCount, 40);
    // Fetch a window ending just before current messages
    const offset = Math.max(0, olderCount - chunkSize);
    const limit = olderCount - offset;
    getChatHistory({ offset, limit })
      .then((result) => {
        send({ type: "PREPEND_MESSAGES", messages: result.entries });
      })
      .catch(() => {})
      .finally(() => setLoadingOlder(false));
  }, [loadingOlder, messages.length, totalEntries, send]);

  const doSend = useCallback(
    (wrapped: string) => {
      send({ type: "SEND", message: wrapped });
    },
    [send]
  );

  const zoomedViewAttr = useCallback(() => {
    if (!zoomedView) return "";
    const uri = `view:${serializeViewUrl(zoomedView.target)}`;
    return ` zoomed-view="${uri}"`;
  }, [zoomedView]);

  const timePassedAttr = useCallback(() => {
    if (messages.length === 0) return "";
    const last = messages[messages.length - 1];
    const elapsed = Date.now() - new Date(last.timestamp).getTime();
    const formatted = formatTimePassed(elapsed);
    return formatted ? ` time-passed="${formatted}"` : "";
  }, [messages]);

  // doSend with attachments — used by handleSend below. Defined as ref rather
  // than a separate useCallback to avoid circular deps with `send`.
  const doSendWithImages = useCallback(
    (wrapped: string, images: ChatImageAttachment[]) => {
      if (images.length > 0) {
        send({ type: "SEND", message: wrapped, images });
      } else {
        send({ type: "SEND", message: wrapped });
      }
    },
    [send]
  );

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    turnTakingRef.current = false;
    unlockAudioContext();

    // Convert UI attachments to the wire-format images payload.
    const images: ChatImageAttachment[] = attachments.map((a) => ({
      id: a.id,
      mimeType: a.mimeType,
      dataBase64: a.dataBase64,
    }));

    const wrapped = `<typed local-time="${localTime()}"${zoomedViewAttr()}${timePassedAttr()}>${text}</typed>`;

    // Release the object URLs after send — the base64 payload is independent
    // of the object URL, so dropping them doesn't affect the message.
    for (const a of attachments) {
      try { URL.revokeObjectURL(a.objectUrl); } catch { /* already revoked */ }
    }
    setAttachments([]);
    nextAttachmentIdRef.current = 1;

    setInput("");
    doSendWithImages(wrapped, images);
    setScrollToBottomTrigger((n) => n + 1);
    if (typingMode && !typingLocked) {
      setTypingMode(false);
    }
  }, [input, attachments, doSendWithImages, zoomedViewAttr, timePassedAttr, typingMode, typingLocked]);

  /**
   * Accept image files (from paste or drop) — downscale, encode, and add
   * to the attachment panel. Inserts `[imageN]` at the current cursor
   * position in the textarea (or appends if the textarea isn't focused).
   */
  const addImageFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    // Process images in parallel; collect results in original order.
    const processed = await Promise.all(
      files.map(async (f) => {
        try {
          return await processImageBlob(f);
        } catch (e) {
          console.error("[chat] Failed to process pasted image:", e);
          return null;
        }
      })
    );

    const startId = nextAttachmentIdRef.current;
    const newItems: AttachmentItem[] = [];
    for (const p of processed) {
      if (!p) continue;
      newItems.push({
        id: nextAttachmentIdRef.current++,
        mimeType: p.mimeType,
        dataBase64: p.dataBase64,
        objectUrl: p.objectUrl,
        byteLength: p.byteLength,
      });
    }
    if (newItems.length === 0) return;

    setAttachments((prev) => [...prev, ...newItems]);

    // Build the `[imageN] [imageN+1] ...` token string and insert at cursor.
    const tokens = newItems.map((a) => `[image${a.id}]`).join(" ");
    const ta = textareaRef.current;
    if (ta && document.activeElement === ta) {
      const selStart = ta.selectionStart ?? ta.value.length;
      const selEnd = ta.selectionEnd ?? selStart;
      const before = input.slice(0, selStart);
      const after = input.slice(selEnd);
      // Pad with a space before the tokens if needed so they don't glue to
      // the preceding word.
      const pad = before.length > 0 && !/\s$/.test(before) ? " " : "";
      const next = before + pad + tokens + after;
      setInput(next);
      // Restore cursor after the inserted tokens.
      const cursorAt = (before + pad + tokens).length;
      requestAnimationFrame(() => {
        if (ta.isConnected) {
          ta.focus();
          ta.setSelectionRange(cursorAt, cursorAt);
        }
      });
    } else {
      setInput((prev) => (prev ? prev + " " + tokens : tokens));
    }
    // startId is the first id just assigned — used in logging only
    void startId;
  }, [input]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const images = extractImageFiles(e.clipboardData);
    if (images.length === 0) return;
    e.preventDefault();
    void addImageFiles(images);
  }, [addImageFiles]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    const images = extractImageFiles(e.dataTransfer);
    if (images.length === 0) return;
    e.preventDefault();
    void addImageFiles(images);
  }, [addImageFiles]);

  const removeAttachment = useCallback((id: number) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) {
        try { URL.revokeObjectURL(target.objectUrl); } catch { /* already revoked */ }
      }
      return prev.filter((a) => a.id !== id);
    });
    // Strip any `[imageN]` tokens for this id from the input (plus up to one
    // leading/trailing whitespace char so we don't leave stray gaps).
    setInput((prev) =>
      prev
        .replace(/\s?\[image(\d+)]\s?/g, (match, n: string) =>
          parseInt(n, 10) === id ? " " : match
        )
        .replace(/ {2,}/g, " ")
    );
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleInterrupt = useCallback(() => {
    send({ type: "INTERRUPT" });
  }, [send]);

  const handleNewSession = useCallback(() => {
    send({ type: "NEW_SESSION" });
  }, [send]);

  const handleStopProcess = useCallback(() => {
    send({ type: "INTERRUPT" });
  }, [send]);

  // Realtime transcription with voice keyword spotting
  const transcription = useRealtimeTranscription({
    onKeywordSend: (text) => {
      // Cancel current recording then immediately restart to keep mic open
      transcription.cancel();
      if (text.trim()) {
        sendSound.play();
        stopTickRef.current = tick.repeatPlay(1000, 30000);
        doSend(`<speech local-time="${localTime()}"${zoomedViewAttr()}${timePassedAttr()}>${text}</speech>`);
      }
      // Restart recording so the user can keep talking
      transcription.start();
    },
    onKeywordCancel: () => {
      transcription.cancel();
    },
    onKeywordMicOff: () => {
      turnTakingRef.current = false;
    },
    onKeywordErase: () => {
      // Transcript is already cleared by the hook; nothing else needed
    },
  });
  useEffect(() => {
    transcriptionRef.current = transcription;
  });
  const isTranscribing =
    transcription.state === "connecting" ||
    transcription.state === "recording" ||
    transcription.state === "finalizing";

  // When transcription ends with an error, preserve partial text into the input field.
  // Uses queueMicrotask to avoid synchronous setState within the effect body.
  const prevTranscribingRef = useRef(false);
  useEffect(() => {
    const wasTranscribing = prevTranscribingRef.current;
    prevTranscribingRef.current = isTranscribing;
    if (wasTranscribing && !isTranscribing && transcription.error && transcription.transcript.trim()) {
      const partial = transcription.transcript.trim();
      console.log("[chat] Preserved partial transcript on error:", partial.slice(0, 80));
      queueMicrotask(() => {
        setInput((prev) => (prev ? prev + " " + partial : partial));
      });
    }
  }, [isTranscribing, transcription.error, transcription.transcript]);

  const handleCancelTranscription = useCallback(() => {
    turnTakingRef.current = false;
    transcription.cancel();
  }, [transcription]);

  const handleStopSpeech = useCallback(() => {
    speechPlayback.stop();
  }, [speechPlayback]);

  // Keep textarea focused when it's visible and available for input.
  // On mobile (< sm), the textarea is only visible in typing mode or while transcribing.
  // Safari needs a short delay after the element appears before focus will open the keyboard.
  useEffect(() => {
    if (!isTranscribing && textareaRef.current) {
      // Only focus if the textarea is actually visible (not hidden by mobile bar)
      if (textareaRef.current.offsetParent !== null) {
        textareaRef.current.focus();
      }
    }
    if (typingMode) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
  }, [isTranscribing, typingMode]);

  // Scroll textarea to bottom as transcript streams in
  useEffect(() => {
    if (isTranscribing && textareaRef.current) {
      const el = textareaRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [isTranscribing, transcription.transcript]);

  // Escape key cancels transcription
  useEffect(() => {
    if (!isTranscribing) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        transcription.cancel();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isTranscribing, transcription]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-warm-500">
        Loading chat...
      </div>
    );
  }

  return (
    <>
    <div className={`h-full flex ${zoomedView ? "flex-col md:flex-row" : "flex-col"} bg-gradient-to-b from-warm-50 to-warm-200 overflow-hidden`}>
      {zoomedView ? (
        <CompanionViewPanel view={zoomedView} onClose={() => setZoomedView(null)} />
      ) : null}
    <div className="flex-1 flex flex-col min-h-0 min-w-0 max-w-5xl w-full mx-auto">
      {/* Header with debug controls */}
      <div className="flex-shrink-0 flex items-center px-4 py-2 bg-gradient-to-r from-accent via-coral to-primary">
        <h2 className="flex-1 text-sm font-semibold text-white tracking-wide">Chat</h2>
        <RecentFilesButton
          entries={messages}
          onPanel={(summary) => onZoomView({
            target: { path: summary.path, viewer: null, params: {}, zoom: false },
            label: summary.title,
          })}
        />
        <SessionListButton />
        <NewSessionButton onClick={handleNewSession} />
        <ChatDebugMenu
          onStopProcess={handleStopProcess}
          sessionId={sessionId}
          running={processRunning}
          busy={isStreaming}
          debugView={debugView}
          onToggleDebugView={() => setDebugView((v) => !v)}
          showDebugLog={showDebugLog}
          onToggleDebugLog={() => setShowDebugLog((v) => !v)}
        />
      </div>
      {/* Messages area — virtualized */}
      <VirtualizedMessageList
        messages={messages}
        isStreaming={isStreaming}
        streamText={streamText}
        streamTools={streamTools}
        debugView={debugView}
        currentUserEmail={currentUser?.email}
        speechPlayback={speechPlayback}
        handleStopSpeech={handleStopSpeech}
        onZoomView={onZoomView}
        snapshot={snapshot}
        totalEntries={totalEntries}
        onLoadOlder={handleLoadOlder}
        loadingOlder={loadingOlder}
        scrollToBottomTrigger={scrollToBottomTrigger}
      />

      {/* Error display */}
      {error || transcription.error ? (
        <div className="px-4 py-2 bg-danger-50 border-t border-danger-light text-danger-dark text-sm">
          {error || transcription.error}
          <button
            onClick={() => {
              send({ type: "DISMISS_ERROR" });
              transcription.dismissError();
            }}
            className="ml-2 text-danger hover:text-danger-dark"
          >
            dismiss
          </button>
        </div>
      ) : null}

      {/* Active schedules */}
      {activeSchedules.length > 0 ? (
        <div className="px-4 py-1.5 border-t border-warm-300 bg-warm-50 flex flex-wrap gap-1.5">
          {activeSchedules.map((s) => (
            <SchedulePill
              key={s.id}
              schedule={s}
              onCancel={() => handleCancelSchedule(s.label)}
              onFired={() => {
                if (s.alarm) alarm.play();
                if (s.announce) {
                  getTTSClient().speak(s.announce).catch(() => {});
                }
              }}
            />
          ))}
        </div>
      ) : null}

      {/* Image attachment panel: shows thumbnails above the composer */}
      <AttachmentPanel attachments={attachments} onRemove={removeAttachment} />

      {/* Input area: single row on desktop, button bar on mobile (hidden on mobile when typing) */}
      <ChatInputArea
        hideMobile={typingMode}
          textareaRef={textareaRef}
          input={input}
          setInput={setInput}
          isTranscribing={isTranscribing}
          transcription={transcription}
          handleKeyDown={handleKeyDown}
          handleSend={handleSend}
          handleCancelTranscription={handleCancelTranscription}
          onKeyboard={() => setTypingMode(true)}
          onVoice={async () => {
            turnTakingRef.current = true;
            await recordingStart.play().started;
            transcription.start();
          }}
          speechPlaying={speechPlayback.isPlaying}
          onStopSpeech={handleStopSpeech}
          isStreaming={isStreaming}
          onInterrupt={handleInterrupt}
          turnTakingRef={turnTakingRef}
          doSend={doSend}
          zoomedViewAttr={zoomedViewAttr}
          timePassedAttr={timePassedAttr}
          voicePaused={voicePaused ? speechPlayback.isPlaying : false}
          onUnpause={() => {
            // Abort speech and resume recording
            speechPlayback.stop();
            voicePausedRef.current = false;
            setVoicePaused(false);
            transcription.start();
          }}
          onPaste={handlePaste}
          onDrop={handleDrop}
        />
      {/* Mobile typing row: replaces button bar when typing/transcribing */}
      {(typingMode || isTranscribing) ? (
        <div className="sm:hidden relative bg-gradient-to-r from-warm-100 via-warm-100 to-warm-200 px-3 pb-2">
          {typingMode ? (
            <div className="absolute -top-10 right-3 flex gap-1 z-10">
              <button
                onClick={() => setTypingLocked((v) => !v)}
                className="p-1.5 rounded-full bg-warm-100/90 text-warm-600 hover:bg-warm-300 shadow-sm backdrop-blur-sm"
                title={typingLocked ? "Unlock (close after send)" : "Lock open"}
              >
                {typingLocked ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => { setTypingMode(false); setTypingLocked(false); }}
                className="p-1.5 rounded-full bg-warm-100/90 text-warm-600 hover:bg-warm-300 shadow-sm backdrop-blur-sm"
                title="Close keyboard"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : null}
          <MobileTextareaRow
            input={input}
            setInput={setInput}
            isTranscribing={isTranscribing}
            transcription={transcription}
            handleKeyDown={handleKeyDown}
            handleSend={handleSend}
            handleCancelTranscription={handleCancelTranscription}
            turnTakingRef={turnTakingRef}
            doSend={doSend}
            zoomedViewAttr={zoomedViewAttr}
            timePassedAttr={timePassedAttr}
            onPaste={handlePaste}
            onDrop={handleDrop}
          />
        </div>
      ) : null}
    </div>
    </div>
    {showDebugLog ? <DebugLogPanel onClose={() => setShowDebugLog(false)} /> : null}
    </>
  );
}

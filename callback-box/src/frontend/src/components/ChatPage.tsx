/**
 * ChatPage - Full-page chat interface for the box's conversational assistant.
 *
 * Streams messages from the backend ChatSession via SSE.
 * User input is wrapped in <typed> tags before sending.
 * User messages are right-aligned dark bubbles; assistant uses markdown.
 *
 * When `?session=<id>` is present in the URL, renders a read-only
 * SessionViewer instead of the interactive chat.
 */

import { useState, useEffect, useRef, useCallback } from "react";
// search params read via window.location — avoids coupling to route definition
import { useSSRMachine } from "../hooks/useSSRMachine";
import TextareaAutosize from "react-textarea-autosize";
import { getApiBase, getEventSourceBase, type SessionEntry } from "../api";
import { useRealtimeTranscription } from "../hooks/useRealtimeTranscription";
import { useSpeechPlayback } from "../hooks/useSpeechPlayback";
import { hasAssistantSpeech, parseAllSpeechTags, VALID_VOICES } from "../lib/speech-parsing";
import { getTTSClient } from "../lib/tts-client";
import { unlockAudioContext } from "../lib/audio-context";
import { Grid } from "ldrs/react";
import "ldrs/react/Grid.css";
import { sendSound, tick, recordingStart, alarm } from "../lib/earcons";
import { MicrophoneIcon, RecordingIndicator } from "./VoiceRecorder";
import { DebugLogPanel } from "./DebugLog";
import { chatMachine } from "../machines/chatMachine.js";
import { UserMessage, AssistantMessage, CompactionMessage, ToolList, MarkdownContent, groupMessages, type OnZoomView } from "./ChatMessages";
import { ViewDispatcher } from "./ViewDispatcher";
import { serializeViewUrl, type ViewTarget } from "../lib/view-url";
import { SessionViewer, SessionListButton } from "./SessionViewer";
import { useSSE, type SSEEvent } from "../hooks/useSSE";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useParams } from "@tanstack/react-router";
import { href } from "../lib/routing";
import type { ChatSchedule } from "../../../core/chat-schedules";

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
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gold/15 text-gold-dark text-xs font-medium border border-gold/30">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {schedule.label}: {remaining}
      {schedule.alarm ? " 🔔" : null}
      <button
        onClick={onCancel}
        className="ml-0.5 text-gold-dark/60 hover:text-gold-dark"
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
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded hover:bg-white/20 text-white/80 hover:text-white"
        title="Debug controls"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
        </svg>
      </button>
      {open ? (
        <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-warm-300 rounded-lg shadow-lg z-50 py-1">
          <button
            onClick={() => { onStopProcess(); setOpen(false); }}
            disabled={!running}
            className="w-full text-left px-3 py-2 text-sm hover:bg-warm-100 text-warm-700 disabled:text-warm-500 disabled:hover:bg-warm-50"
          >
            Stop Process
          </button>
          <div className="border-t border-warm-200 my-1" />
          <button
            onClick={() => { onToggleDebugView(); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-warm-100 text-warm-700"
          >
            {debugView ? "\u2713 " : ""}Debug View
          </button>
          <button
            onClick={() => { onToggleDebugLog(); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-warm-100 text-warm-700"
          >
            {showDebugLog ? "\u2713 " : ""}Debug Log
          </button>
          <div className="border-t border-warm-200 my-1" />
          <div className="px-3 py-1.5 text-xs text-warm-500">
            <div>Session: {sessionId ? sessionId.slice(0, 12) + "..." : "none"}</div>
            <div>Process: {running ? (busy ? "busy" : "idle") : "stopped"}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Companion view panel shown alongside chat when a view is zoomed.
 */
function CompanionViewPanel({ view, onClose }: { view: { target: ViewTarget; label: string }; onClose: () => void }) {
  return (
    <div className="h-[40vh] md:h-full md:w-1/2 flex-shrink-0 flex flex-col border-b md:border-b-0 md:border-r border-warm-300 bg-white">
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-warm-300 bg-warm-50">
        <span className="text-sm font-medium truncate">{view.label}</span>
        <button
          onClick={onClose}
          className="ml-2 flex-shrink-0 p-1 text-warm-500 hover:text-warm-700 rounded hover:bg-warm-200"
          title="Close companion view"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        <ViewDispatcher target={view.target} mode="companion" />
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
  isStreaming, onInterrupt, turnTakingRef, doSend, zoomedViewAttr,
  voicePaused, onUnpause,
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
  voicePaused: boolean;
  onUnpause: () => void;
}) {
  const { boxSlug } = useParams({ strict: false });
  const captureHref = href(`/${boxSlug}/capture`);

  const circleBtn = "flex items-center justify-center w-14 h-14 rounded-full flex-shrink-0";

  return (
    <div className="flex-shrink-0 border-t border-warm-300 bg-gradient-to-r from-warm-100 via-warm-100 to-warm-200 px-3 py-2">
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
            value={isTranscribing ? transcription.transcript : input}
            onChange={(e) => { if (!isTranscribing) setInput(e.target.value); }}
            onKeyDown={handleKeyDown}
            disabled={isTranscribing}
            readOnly={isTranscribing}
            placeholder={isTranscribing ? "Listening..." : "Type a message..."}
            className="flex-1 resize-none rounded-lg border border-warm-400 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent disabled:bg-warm-200 disabled:text-warm-600 min-w-0"
            minRows={1}
            maxRows={8}
          />
          {isTranscribing ? (
            <>
              <button
                onClick={handleCancelTranscription}
                className="p-2 text-rose hover:text-rose-dark rounded-lg hover:bg-rose-50 flex-shrink-0"
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
                  if (text) doSend(`<speech local-time="${localTime()}"${zoomedViewAttr()}>${text}</speech>`);
                }}
                className={`${circleBtn} bg-gold text-white hover:bg-gold-dark`}
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
              className={`${circleBtn} bg-gold text-white hover:bg-gold-dark disabled:bg-iris-muted disabled:text-white/70 disabled:cursor-not-allowed`}
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
            className={`${circleBtn} bg-rose-100 text-rose hover:bg-rose-200 active:bg-rose-300`}
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
            className={`${circleBtn} bg-rose-100 text-rose hover:bg-rose-200 active:bg-rose-300`}
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
          className={`${circleBtn} ${voicePaused ? "bg-plum/50 text-white animate-pulse" : isTranscribing ? "bg-rose text-white hover:bg-rose-dark active:opacity-80" : "bg-plum text-white hover:bg-plum-dark active:opacity-80"}`}
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
  turnTakingRef, doSend, zoomedViewAttr,
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
        disabled={isTranscribing}
        readOnly={isTranscribing}
        placeholder={isTranscribing ? "Listening..." : "Type a message..."}
        className="flex-1 resize-none rounded-lg border border-warm-400 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent disabled:bg-warm-200 disabled:text-warm-600"
        minRows={2}
        maxRows={8}
        autoFocus
      />
      {isTranscribing ? (
        <>
          <button
            onClick={handleCancelTranscription}
            className="p-2 text-rose hover:text-rose-dark rounded-lg hover:bg-rose-50 flex-shrink-0"
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
              if (text) doSend(`<speech local-time="${localTime()}"${zoomedViewAttr()}>${text}</speech>`);
            }}
            className={`${circleBtn} bg-gold text-white hover:bg-gold-dark`}
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
          className={`${circleBtn} bg-gold text-white hover:bg-gold-dark disabled:bg-iris-muted disabled:text-white/70 disabled:cursor-not-allowed`}
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

export function ChatPage() {
  const viewSessionId = new URLSearchParams(window.location.search).get("session");

  // If viewing a specific session, render read-only viewer
  if (viewSessionId) {
    return <SessionViewer sessionId={viewSessionId} />;
  }

  return <InteractiveChat />;
}

function InteractiveChat() {
  const [snapshot, send] = useSSRMachine(chatMachine);
  const { messages, streamText, streamTools, error, sessionId, processRunning } = snapshot.context;
  const isStreaming = snapshot.matches("streaming") || snapshot.matches("refreshing");
  const isLoading = snapshot.matches("loading");
  const currentUser = useCurrentUser();

  const [input, setInput] = useState("");
  const [showAllMessages, setShowAllMessages] = useState(false);
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
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

  // Handle state transitions: speech playback on result, mic restart after refresh
  useEffect(() => {
    const current = snapshot.value as string;
    const prev = prevStateRef.current;
    prevStateRef.current = current;

    // streaming → refreshing: play speech, stop tick
    if (current === "refreshing" && prev === "streaming") {
      if (stopTickRef.current) {
        stopTickRef.current();
        stopTickRef.current = null;
      }
      const hasSpeech = hasAssistantSpeech(snapshot.context.streamText);
      speechPlayedRef.current = hasSpeech;
      if (hasSpeech) {
        // Suppress TTS if user has in-progress voice text
        const hasActiveTranscript = transcriptionRef.current &&
          transcriptionRef.current.transcript.trim().length > 0;
        if (hasActiveTranscript) {
          // Don't play speech — user is composing
          speechPlayback.markAsPlayed(`stream-${Date.now()}`);
        } else {
          // Pause recording while TTS plays
          if (transcriptionRef.current && transcriptionRef.current.state === "recording") {
            voicePausedRef.current = true;
            queueMicrotask(() => setVoicePaused(true));
            transcriptionRef.current.cancel();
          }
          const segments = parseAllSpeechTags(snapshot.context.streamText);
          speechPlayback.playSegments({
            messageId: `stream-${Date.now()}`,
            segments,
          });
        }
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
  }, [snapshot.value, snapshot.context.streamText, speechPlayback]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

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

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    turnTakingRef.current = false;
    unlockAudioContext();
    setInput("");
    doSend(`<typed local-time="${localTime()}"${zoomedViewAttr()}>${text}</typed>`);
    if (typingMode && !typingLocked) {
      setTypingMode(false);
    }
  }, [input, doSend, zoomedViewAttr, typingMode, typingLocked]);

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
        doSend(`<speech local-time="${localTime()}"${zoomedViewAttr()}>${text}</speech>`);
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
  useEffect(() => {
    if (!isTranscribing && textareaRef.current) {
      // Only focus if the textarea is actually visible (not hidden by mobile bar)
      if (textareaRef.current.offsetParent !== null) {
        textareaRef.current.focus();
      }
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
      <div className="flex-shrink-0 flex items-center px-4 py-2 bg-gradient-to-r from-gold via-coral to-plum">
        <h2 className="flex-1 text-sm font-semibold text-white tracking-wide">Chat</h2>
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
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-4 pl-2 sm:pl-4 space-y-1 min-w-0">
        {messages.length === 0 && !isStreaming ? (
          <div className="flex items-center justify-center h-full text-warm-500 text-sm">
            Start a conversation with your box assistant.
          </div>
        ) : null}
        {(() => {
          const MAX_USER_MESSAGES = 10;
          let displayMessages = messages;
          let truncated = false;
          if (!showAllMessages) {
            // Find the start index that keeps the last N user messages
            let userCount = 0;
            let cutIndex = -1;
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i]!.type === "user") userCount++;
              if (userCount > MAX_USER_MESSAGES) {
                cutIndex = i + 1;
                break;
              }
            }
            if (cutIndex > 0) {
              truncated = true;
              displayMessages = messages.slice(cutIndex);
            }
          }
          return (
            <>
              {truncated ? (
                <div className="text-center py-2">
                  <button
                    onClick={() => setShowAllMessages(true)}
                    className="text-sm text-plum hover:text-plum/80"
                  >
                    Show {messages.length - displayMessages.length} earlier messages
                  </button>
                </div>
              ) : null}
              {(() => {
                const groups = groupMessages(displayMessages);
                const lastAssistantGroup = groups.findLast((g) => g.type === "assistant");
                return groups.map((group) =>
                  group.type === "compaction" ? (
                    <CompactionMessage key={group.entries[0].uuid} entries={group.entries} />
                  ) : group.type === "user" ? (
                    <UserMessage key={group.entries[0].uuid} entries={group.entries} debugView={debugView} currentUserEmail={currentUser?.email} />
                  ) : (
                    <AssistantMessage key={group.entries[0].uuid} entries={group.entries} debugView={debugView} speechPlaying={Boolean(speechPlayback.isPlaying && group === lastAssistantGroup)} onStopSpeech={handleStopSpeech} onZoomView={onZoomView} />
                  )
                );
              })()}
            </>
          );
        })()}
        {snapshot.matches("streaming") ? (
          <div>
            <StreamingMessage text={streamText} onZoomView={onZoomView} />
            {streamTools.length > 0 ? (
              <div className="pl-3 sm:pl-6 pr-4 sm:pr-24 pb-2">
                <ToolList blocks={streamTools} />
              </div>
            ) : null}
          </div>
        ) : null}
        <div ref={messagesEndRef} />
      </div>

      {/* Error display */}
      {error || transcription.error ? (
        <div className="px-4 py-2 bg-rose-50 border-t border-rose-light text-rose-dark text-sm">
          {error || transcription.error}
          <button
            onClick={() => {
              send({ type: "DISMISS_ERROR" });
              transcription.dismissError();
            }}
            className="ml-2 text-rose hover:text-rose-dark"
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

      {/* Input area: single row on desktop, button bar + optional typing row on mobile */}
      <ChatInputArea
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
        voicePaused={voicePaused ? speechPlayback.isPlaying : false}
        onUnpause={() => {
          // Abort speech and resume recording
          speechPlayback.stop();
          voicePausedRef.current = false;
          setVoicePaused(false);
          transcription.start();
        }}
      />
      {/* Mobile typing row: shown below button bar when typing/transcribing */}
      {(typingMode || isTranscribing) ? (
        <div className="sm:hidden bg-gradient-to-r from-warm-100 via-warm-100 to-warm-200 px-3 pb-2">
          {typingMode ? (
            <div className="flex gap-1 justify-end pb-1">
              <button
                onClick={() => setTypingLocked((v) => !v)}
                className="p-1.5 rounded-full bg-warm-200 text-warm-600 hover:bg-warm-300"
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
                className="p-1.5 rounded-full bg-warm-200 text-warm-600 hover:bg-warm-300"
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
          />
        </div>
      ) : null}
    </div>
    </div>
    {showDebugLog ? <DebugLogPanel onClose={() => setShowDebugLog(false)} /> : null}
    </>
  );
}

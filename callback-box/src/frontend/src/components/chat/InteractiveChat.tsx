/**
 * InteractiveChat - the live chat UI for the box's conversational assistant.
 *
 * Streams messages from the backend ChatSession via SSE.
 * User input is wrapped in <typed> tags before sending.
 * User messages are right-aligned dark bubbles; assistant uses markdown.
 *
 * Receives `sessionInput` from ChatPage — either an existing session id or
 * the `"new"` sentinel for a fresh conversation. Keyed on that prop so
 * a session switch (or new-chat reset) cleanly remounts the machine.
 */

import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
// search params read via window.location — avoids coupling to route definition
import { useSSRMachine } from "../../hooks/useSSRMachine";
import TextareaAutosize from "react-textarea-autosize";
import { getApiBase, getEventSourceBase, getChatHistory, getChatStatus, setChatModel, restartChatSubprocess, getChatFeatures, setChatFeature, postAudioForHqTranscription, type SessionEntry, type SessionContentBlock, type ChatImageAttachment } from "../../api";
import { AttachmentPanel, FileAttachmentPanel, type AttachmentItem, type FileAttachmentItem } from "../ChatAttachments";
import { extractImageFiles, processImageBlob } from "../../lib/image-paste";
import { uploadChatFile } from "../../lib/file-upload";
import { useRealtimeTranscription } from "../../hooks/useRealtimeTranscription";
import { detectKeyword } from "../../lib/speech-keywords";
import { useSpeechPlayback } from "../../hooks/useSpeechPlayback";
import { parseAllSpeechTags, VALID_VOICES, type SpeechSegment } from "../../lib/speech-parsing";
import { getTTSClient } from "../../lib/tts-client";
import { unlockAudioContext } from "../../lib/audio-context";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Grid } from "ldrs/react";
import "ldrs/react/Grid.css";
import { sendSound, tick, recordingStart, recordingStop, alarm } from "../../lib/earcons";
import { MicrophoneIcon, RecordingIndicator } from "../VoiceRecorder";
import { DebugLogPanel } from "../DebugLog";
import { MessageErrorBoundary } from "./MessageErrorBoundary";
import { chatMachine, HISTORY_TAIL, MIN_REAL_USER_MESSAGES } from "../../machines/chatMachine.js";
import { UserMessage, AssistantMessage, CompactionMessage, InterruptedMessage, SelfNoteMessage, ToolList, MarkdownContent, UserMessageText, groupMessages, extractChatImages, type MessageGroup, type OnZoomView } from "../ChatMessages";
import { isNoResponseOnly } from "../../lib/structured-output-parsing";
import { FileView } from "../FileView";
import { Dropdown, MenuItem, MenuDivider } from "../ui/Dropdown";
import { CloseButton } from "../ui/CloseButton";
import { ExternalIconLink } from "../ui/ExternalIconLink";
import { serializeViewUrl, type NavigateHint, type ViewTarget } from "../../lib/view-url";
import { SessionListButton } from "../SessionListButton";
import { RecentFilesButton } from "../RecentFilesButton";
import { cn } from "../../lib/cn";
import { useSSE, type SSEEvent } from "../../hooks/useSSE";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useNavigate, useParams } from "@tanstack/react-router";
import { href } from "../../lib/routing";
import type { ChatSchedule } from "../../../../core/chat-schedules";
import { trpc } from "../../lib/trpc";

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
/**
 * Type guard for the `chat-features-changed` SSE event payload. Returns
 * the narrowed payload if shape matches, otherwise null — keeps the
 * `event.data: unknown` from the SSE machine type-safe at the use site.
 */
function parseFeaturesChangedPayload(
  data: unknown,
): { sessionId: string; features: Record<string, string> } | null {
  function reject(reason: string): null {
    // Server contract violation — log so it doesn't slip past in production.
    console.warn(`[chat] chat-features-changed payload rejected: ${reason}`);
    return null;
  }
  if (data === null || typeof data !== "object") return reject("not an object");
  if (!("sessionId" in data) || typeof data.sessionId !== "string") return reject("missing sessionId");
  if (!("features" in data) || data.features === null || typeof data.features !== "object") {
    return reject("missing features");
  }
  const features: Record<string, string> = {};
  for (const [k, v] of Object.entries(data.features)) {
    if (typeof v === "string") features[k] = v;
    else console.warn(`[chat] chat-features-changed: dropping non-string value for ${k}`);
  }
  return { sessionId: data.sessionId, features };
}

/**
 * Apply a chat-features-changed payload to local state if the session id
 * matches (or no session id filter is in effect). Module-scoped so the
 * SSE dispatcher useCallback can stay under the complexity budget.
 */
function applyFeaturesChange(opts: {
  data: unknown;
  currentSessionId: string | null;
  setFeatures: (features: Record<string, string>) => void;
}): void {
  const payload = parseFeaturesChangedPayload(opts.data);
  if (!payload) return;
  if (opts.currentSessionId && payload.sessionId !== opts.currentSessionId) return;
  opts.setFeatures(payload.features);
}

/**
 * Header chip that signals narration mode is active. Shows a "transcribing…"
 * sub-label while the HQ pass is in flight after a send-message checkpoint,
 * so the user can see the agent isn't ignoring them — it's waiting on the
 * round-trip to the HQ transcription service.
 */
/**
 * Mic-with-chat-bubble icon used in place of the standard handheld mic
 * when narration is enabled. Hints at "long talking" — the mic with a
 * speech bubble suggests an extended utterance rather than a one-shot
 * command.
 */
function NarrationMicIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {/* Chat bubble (top-right) */}
      <path
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14 3h6a1 1 0 011 1v5a1 1 0 01-1 1h-3.5L14 12.5V3z"
      />
      {/* Mic body (bottom-left) */}
      <rect x="5" y="9" width="5" height="8" rx="2.5" strokeWidth={2} />
      <path
        strokeWidth={2}
        strokeLinecap="round"
        d="M3 14a4.5 4.5 0 009 0M7.5 19v2.5m-2 0h4"
      />
    </svg>
  );
}

function NarrationStatusBadge({
  enabled,
  hqInFlight,
  onTurnOff,
}: {
  enabled: boolean;
  hqInFlight: boolean;
  onTurnOff: () => void;
}) {
  if (!enabled) return null;
  return (
    <span
      className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-white/20 text-white text-xs font-medium"
      title="Narration mode is on — silent responses, structured output, HQ transcription on send"
    >
      <span aria-hidden>🎙️</span>
      <span>narration</span>
      {hqInFlight ? <span className="opacity-80">· transcribing…</span> : null}
      <button
        type="button"
        onClick={onTurnOff}
        aria-label="Turn off narration mode"
        title="Turn off narration"
        className="ml-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-white/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}

function localTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

// Minted at SEND-dispatch time and threaded through to /chat/send so the
// backend's processedMessageIds dedupe (chat.ts:269-284) catches the case
// where the streamActor body runs twice for one logical send (StrictMode
// double-mount, accidental double-dispatch, etc.).
function newMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function composerTextareaClasses({ mobile, isTranscribing }: { mobile: boolean; isTranscribing: boolean }): string {
  const sizeClass = mobile ? "text-base" : "text-sm min-w-0";
  const stateClass = isTranscribing
    ? "bg-white text-warm-800 border-primary/40 shadow-[0_0_0_1px_rgba(56,149,211,0.08)]"
    : "bg-white border-warm-400";
  return `flex-1 resize-none rounded-lg px-3 py-2 ${sizeClass} ${stateClass} focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent placeholder:text-warm-500`;
}

/**
 * Format a millisecond gap as "Xh" or "XdYh" (hours omitted when zero).
 * Returns null when the gap is under 6 hours — callers should omit the attribute then.
 */
function formatTimePassed(ms: number): string | null {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  if (ms < SIX_HOURS) return null;
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
 * Model options surfaced in the chat debug menu. `null` = CLI default.
 * Ordered as presented to the user.
 */
const MODEL_OPTIONS: ReadonlyArray<{ label: string; model: string | null }> = [
  { label: "Default (Opus)", model: null },
  { label: "Sonnet 4.6", model: "claude-sonnet-4-6" },
  { label: "Opus 4.7", model: "claude-opus-4-7" },
  { label: "Haiku 4.5", model: "claude-haiku-4-5-20251001" },
  { label: "Opus 4.7 (1M context)", model: "claude-opus-4-7[1m]" },
];

type TranscriptionServiceOption = "voxtral" | "deepgram" | "whisper";
type HqTranscriptionOption = "whisper" | "voxtral";

const TRANSCRIPTION_OPTIONS: ReadonlyArray<{
  label: string;
  service: TranscriptionServiceOption;
}> = [
  { label: "Voxtral (Mistral)", service: "voxtral" },
  { label: "Deepgram", service: "deepgram" },
];

const HQ_TRANSCRIPTION_OPTIONS: ReadonlyArray<{
  label: string;
  service: HqTranscriptionOption;
}> = [
  { label: "Whisper (OpenAI)", service: "whisper" },
  { label: "Voxtral (Mistral)", service: "voxtral" },
];

/**
 * Ephemeral marker shown in the message stream when the user switches models.
 * `afterGroupCount` snapshots the number of message groups at insertion time
 * — the marker renders between that group and whatever comes after, which
 * gives chronological ordering relative to later-arriving messages.
 * Not persisted: these disappear on page reload.
 */
interface ModelMarker {
  id: string;
  label: string;
  afterGroupCount: number;
}

/**
 * Debug dropdown menu for chat controls.
 */
function ChatDebugMenu({
  onStopProcess,
  onRestartProcess,
  onCompactSession,
  sessionId,
  running,
  busy,
  debugView,
  onToggleDebugView,
  showDebugLog,
  onToggleDebugLog,
  selectedModel,
  onSelectModel,
  narrationEnabled,
  onToggleNarration,
}: {
  onStopProcess: () => void;
  onRestartProcess: () => void;
  onCompactSession: () => void;
  sessionId: string | null;
  running: boolean;
  busy: boolean;
  debugView: boolean;
  onToggleDebugView: () => void;
  showDebugLog: boolean;
  onToggleDebugLog: () => void;
  selectedModel: string | null;
  onSelectModel: (model: string | null) => void;
  narrationEnabled: boolean;
  onToggleNarration: () => void;
}) {
  const transcriptionConfigQuery = trpc.transcription.config.useQuery();
  const setTranscriptionService = trpc.transcription.setService.useMutation();
  const setHqTranscriptionService = trpc.transcription.setHqService.useMutation();
  const utils = trpc.useUtils();
  const currentService = transcriptionConfigQuery.data?.service ?? null;
  const currentHqService = transcriptionConfigQuery.data?.hqService ?? null;

  const onSelectTranscriptionService = async (service: TranscriptionServiceOption) => {
    if (currentService === service) return;
    try {
      await setTranscriptionService.mutateAsync({ service });
      utils.transcription.config.invalidate();
    } catch (e) {
      console.error("[chat] Failed to set transcription service", e);
    }
  };

  const onSelectHqTranscriptionService = async (hqService: HqTranscriptionOption) => {
    if (currentHqService === hqService) return;
    try {
      await setHqTranscriptionService.mutateAsync({ hqService });
      utils.transcription.config.invalidate();
    } catch (e) {
      console.error("[chat] Failed to set HQ transcription service", e);
    }
  };

  // Single-panel submenu pattern: the dropdown swaps which set of rows
  // it renders rather than spawning a flyout. Better on touch and avoids
  // positioning complexity. Resets to "root" when the dropdown closes.
  const [panel, setPanel] = useState<"root" | "model" | "voice">("root");
  const currentModelLabel =
    MODEL_OPTIONS.find((o) => o.model === selectedModel)?.label ?? "Default";

  return (
    <Dropdown
      align="right"
      width="w-56"
      onClose={() => setPanel("root")}
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
      {panel === "root" ? (<>
      <MenuItem onClick={onToggleDebugView}>{debugView ? "✓ " : "  "}Debug View</MenuItem>
      <MenuItem onClick={onToggleNarration} disabled={sessionId === null}>
        {narrationEnabled ? "✓ " : "  "}Narration mode
      </MenuItem>
      <MenuDivider />
      <MenuItem onClick={() => setPanel("model")} keepOpen>
        <span className="flex justify-between gap-2 w-full">
          <span>Model</span>
          <span className="text-warm-500 truncate">{currentModelLabel} ›</span>
        </span>
      </MenuItem>
      <MenuItem onClick={() => setPanel("voice")} keepOpen>
        <span className="flex justify-between gap-2 w-full">
          <span>Voice settings</span>
          <span className="text-warm-500">›</span>
        </span>
      </MenuItem>
      <span className="sm:hidden">
        <MenuItem onClick={onToggleDebugLog}>{showDebugLog ? "✓ " : "  "}Debug Log</MenuItem>
      </span>
      <MenuDivider />
      <MenuItem onClick={onCompactSession} disabled={busy}>Run /compact</MenuItem>
      <MenuItem onClick={onRestartProcess} disabled={!running}>Restart Subprocess</MenuItem>
      <MenuItem onClick={onStopProcess} disabled={!running}>Stop Process</MenuItem>
      <MenuDivider />
      <div className="px-3 py-1.5 text-xs text-warm-500">
        <div>Session: {sessionId ? sessionId.slice(0, 12) + "..." : "none"}</div>
        <div>Process: {running ? (busy ? "busy" : "idle") : "stopped"}</div>
      </div>
      </>) : panel === "model" ? (<>
      <MenuItem onClick={() => setPanel("root")} keepOpen>
        <span className="text-warm-500">‹ Model</span>
      </MenuItem>
      <MenuDivider />
      {MODEL_OPTIONS.map((opt) => (
        <MenuItem key={opt.label} onClick={() => onSelectModel(opt.model)}>
          {selectedModel === opt.model ? "✓ " : "  "}{opt.label}
        </MenuItem>
      ))}
      </>) : (<>
      <MenuItem onClick={() => setPanel("root")} keepOpen>
        <span className="text-warm-500">‹ Voice settings</span>
      </MenuItem>
      <MenuDivider />
      <div className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-warm-500">Live transcription</div>
      {TRANSCRIPTION_OPTIONS.map((opt) => (
        <MenuItem key={opt.service} onClick={() => onSelectTranscriptionService(opt.service)} keepOpen>
          {currentService === opt.service ? "✓ " : "  "}{opt.label}
        </MenuItem>
      ))}
      <MenuDivider />
      <div className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-warm-500">HQ transcription</div>
      {HQ_TRANSCRIPTION_OPTIONS.map((opt) => (
        <MenuItem key={opt.service} onClick={() => onSelectHqTranscriptionService(opt.service)} keepOpen>
          {currentHqService === opt.service ? "✓ " : "  "}{opt.label}
        </MenuItem>
      ))}
      </>)}
    </Dropdown>
  );
}

interface PanelTab {
  target: ViewTarget;
  label: string;
}

/**
 * Companion view panel shown alongside chat when one or more views are open.
 * Tabs are keyed by path: opening a file that's already open reactivates it
 * rather than duplicating a tab, and in-file link clicks open new tabs.
 */
function CompanionViewPanel({
  tabs,
  activePath,
  onSelectTab,
  onCloseTab,
  onClosePanel,
  onNavigate,
}: {
  tabs: PanelTab[];
  activePath: string;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onClosePanel: () => void;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
}) {
  const { boxSlug } = useParams({ strict: false });
  const active = tabs.find((t) => t.target.path === activePath);
  if (!active) return null;
  const browseHref = href(`/${boxSlug}/browse/${active.target.path}`);
  return (
    <div className="h-[40vh] md:h-full md:w-1/2 flex-shrink-0 flex flex-col border-b md:border-b-0 md:border-r border-warm-300 bg-white">
      <div className="flex-shrink-0 flex items-stretch border-b border-warm-300 bg-warm-50 min-w-0">
        <div role="tablist" aria-label="Open files" className="flex-1 min-w-0 flex overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.target.path === activePath;
            return (
              <div
                key={tab.target.path}
                className={cn(
                  "flex-shrink-0 max-w-[14rem] flex items-center border-r border-warm-300 border-b-2",
                  isActive
                    ? "bg-white border-b-primary"
                    : "border-b-transparent hover:bg-warm-100",
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onSelectTab(tab.target.path)}
                  title={tab.target.path}
                  className={cn(
                    "flex-1 min-w-0 truncate text-left text-sm pl-3 pr-1 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    isActive ? "text-warm-900 font-medium" : "text-warm-600",
                  )}
                >
                  {tab.label}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.target.path);
                  }}
                  aria-label={`Close ${tab.label}`}
                  title="Close tab"
                  className="flex-shrink-0 mr-1 p-0.5 rounded text-warm-500 hover:text-warm-800 hover:bg-warm-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6l-12 12" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex-shrink-0 flex items-center gap-1 px-2 border-l border-warm-300">
          <ExternalIconLink href={browseHref} label="Open in browse view (new tab)" size="sm" />
          <CloseButton onClick={onClosePanel} label="Close companion view" size="sm" />
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <FileView
          key={active.target.path}
          path={active.target.path}
          mode="companion"
          rendererName={active.target.viewer}
          onNavigate={onNavigate}
        />
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
  onPaste, onDrop, onAttachFiles, narrationEnabled,
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
  onAttachFiles: () => void;
  narrationEnabled: boolean;
}) {
  const circleBtn = "flex items-center justify-center w-14 h-14 rounded-full flex-shrink-0";

  return (
    <div className={`flex-shrink-0 border-t border-warm-300 bg-gradient-to-r from-warm-100 via-warm-100 to-warm-200 px-3 py-2${hideMobile ? " hidden sm:block" : ""}`}>
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
              className={`${circleBtn} bg-warm-300 text-warm-700 hover:bg-warm-400 active:bg-warm-500`}
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
      </div>
    </div>
  );
}

/**
 * Mobile-only textarea row shown below the button bar when typing or transcribing.
 */
function MobileTextareaRow({
  input, setInput, isTranscribing, transcription,
  handleSend, handleCancelTranscription,
  turnTakingRef, doSend, zoomedViewAttr, timePassedAttr,
  onPaste, onDrop,
}: {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  isTranscribing: boolean;
  transcription: { transcript: string; start: () => void; stop: () => Promise<string>; cancel: () => void };
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
 * Trim a streaming text buffer to the last completed paragraph. The
 * trailing in-progress paragraph (everything after the last "\n\n") is
 * hidden until it completes — avoids showing twitchy mid-sentence
 * fragments as the model types. The full text still lands in the
 * assistant message once the turn ends.
 */
function chunkOnParagraphs(text: string): string {
  const lastBreak = text.lastIndexOf("\n\n");
  if (lastBreak === -1) return "";
  return text.slice(0, lastBreak);
}

/**
 * In-flight user message during narration's HQ transcription pass. Shows
 * the realtime transcript as a faded user bubble with a "finalizing
 * transcript…" caption, so the user sees that the system is working on
 * their message rather than nothing happening.
 */
function PendingHqMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end pl-12 sm:pl-24 py-1">
      <div className="flex flex-col items-end gap-1">
        <div
          className="rounded-l-2xl bg-info text-white px-3 sm:px-4 py-2 min-w-[80px] sm:min-w-[120px] break-words opacity-60"
          title="Finalizing high-quality transcription…"
        >
          <div className="text-sm whitespace-pre-wrap">
            <UserMessageText text={text} />
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-warm-500 pr-2">
          <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
          finalizing transcript…
        </div>
      </div>
    </div>
  );
}

/**
 * Streaming content being built up during a turn.
 */
function StreamingMessage({ text, onZoomView }: { text: string; onZoomView?: OnZoomView }) {
  const visible = chunkOnParagraphs(text);
  return (
    <div className="pr-4 sm:pr-24 pl-3 sm:pl-6 py-2">
      {visible ? (
        <MarkdownContent text={visible} onZoomView={onZoomView} />
      ) : null}
      <div className="flex justify-center mt-6">
        <Grid size={40} color="#D4845A" speed={1.5} /> {/* coral */}
      </div>
    </div>
  );
}

/**
 * Virtualized message list using react-virtuoso. Only renders visible
 * message groups in the DOM, with stick-to-bottom behavior. The streaming
 * tail and "load older" header use virtuoso's data array and Header slot
 * respectively; firstItemIndex tracks prepends so loading older messages
 * doesn't visually jump the user.
 */
type DataItem =
  | { kind: "group"; group: MessageGroup; groupIndex: number; acknowledged?: boolean }
  | { kind: "marker"; marker: ModelMarker }
  | { kind: "stream" }
  | { kind: "processing" }
  | { kind: "pendingHq"; text: string };

/**
 * True when an assistant group's content is exactly one or more
 * `<ack kind="no-response"/>` tags and nothing else. Drives the
 * acknowledged-checkmark badge: instead of rendering an empty assistant
 * bubble, the preceding user message gets the badge so the user sees
 * "received, intentionally silent."
 */
function groupIsNoResponseOnly(group: MessageGroup): boolean {
  if (group.type !== "assistant") return false;
  const allText = group.entries.flatMap((e) =>
    e.content.filter((b) => b.type === "text").map((b) => b.text ?? "")
  ).join("\n");
  return isNoResponseOnly(allText);
}

function dataItemKey(d: DataItem): string {
  switch (d.kind) {
    case "marker": return `marker-${d.marker.id}`;
    case "stream": return "stream";
    case "processing": return "processing";
    case "pendingHq": return "pendingHq";
    case "group": return d.group.entries[0].uuid;
  }
}

const VIRTUOSO_INITIAL_FIRST_INDEX = 1_000_000_000;

// Virtuoso requires Header/Footer components to be stable references; if a
// new component identity is passed each render they remount. We keep them
// module-level and pass dynamic data via the `context` prop instead.
interface ChatListContext {
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  earlierCount: number;
}

function LoadOlderHeader({ context }: { context?: ChatListContext }) {
  if (!context || !context.hasOlder) return null;
  const handleClick = context.onLoadOlder;
  return (
    <div className="text-center py-2">
      <button
        onClick={handleClick}
        disabled={context.loadingOlder}
        className="text-sm text-primary hover:text-primary/80 disabled:text-warm-400"
      >
        {context.loadingOlder ? "Loading..." : `Show ${context.earlierCount} earlier messages`}
      </button>
    </div>
  );
}

function VirtualizedMessageList({
  messages, groups, modelMarkers, isStreaming, streamText, streamTools, processingShown,
  debugView, currentUserEmail, speechPlayback, handleStopSpeech, onZoomView, snapshot,
  totalEntries, onLoadOlder, loadingOlder, scrollToBottomTrigger, proseEnabled, pendingHqDraft,
}: {
  messages: SessionEntry[];
  groups: MessageGroup[];
  modelMarkers: ModelMarker[];
  isStreaming: boolean;
  streamText: string;
  streamTools: SessionContentBlock[];
  processingShown: boolean;
  debugView: boolean;
  currentUserEmail: string | undefined;
  speechPlayback: { isPlaying: boolean };
  handleStopSpeech: () => void;
  onZoomView: OnZoomView;
  snapshot: { matches: (state: "loading" | "idle" | "streaming" | "refreshing") => boolean };
  totalEntries: number;
  onLoadOlder: () => void;
  loadingOlder: boolean;
  scrollToBottomTrigger: number;
  proseEnabled: boolean;
  pendingHqDraft: string | null;
}) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const atBottomRef = useRef(true);
  // Whether we've performed the on-mount scroll-to-bottom yet. Initial
  // load of an existing chat should land at the latest message, not the
  // top — `initialTopMostItemIndex` alone isn't reliable here because data
  // is empty on first render (the parent shows a placeholder until history
  // arrives) and Virtuoso doesn't reapply the prop when data later populates.
  const initialScrollDoneRef = useRef(false);
  const { boxSlug } = useParams({ strict: false });

  const hasOlder = totalEntries > messages.length;
  const streamingShown = snapshot.matches("streaming");

  // Build the data array: groups interleaved with markers (chronological),
  // plus the streaming/processing tail as its own item so virtuoso's
  // followOutput fires when it appears, and so scrollToIndex("LAST")
  // targets it directly during stream growth.
  //
  // Special case: when an assistant group is just `<ack kind="no-response"/>`,
  // suppress its bubble and tag the preceding user item as `acknowledged`,
  // which renders a checkmark badge alongside the user message instead.
  const data = useMemo<DataItem[]>(() => {
    const items: DataItem[] = [];
    for (const m of modelMarkers) {
      if (m.afterGroupCount === 0) items.push({ kind: "marker", marker: m });
    }
    for (const [i, group] of groups.entries()) {
      if (group.type === "assistant" && groupIsNoResponseOnly(group)) {
        const last = items[items.length - 1];
        if (last && last.kind === "group" && last.group.type === "user") {
          last.acknowledged = true;
        }
        // Still emit any markers anchored to this group's position so
        // they land in chronological order.
        for (const m of modelMarkers) {
          if (m.afterGroupCount === i + 1) items.push({ kind: "marker", marker: m });
        }
        continue;
      }
      items.push({ kind: "group", group, groupIndex: i });
      for (const m of modelMarkers) {
        if (m.afterGroupCount === i + 1) items.push({ kind: "marker", marker: m });
      }
    }
    if (pendingHqDraft !== null) items.push({ kind: "pendingHq", text: pendingHqDraft });
    if (streamingShown) items.push({ kind: "stream" });
    else if (processingShown) items.push({ kind: "processing" });
    return items;
  }, [groups, modelMarkers, streamingShown, processingShown, pendingHqDraft]);

  // Track first-data-key across renders. When older messages prepend, the
  // key shifts from data[0] to data[N], and we decrement firstItemIndex by
  // N so virtuoso preserves the user's visual scroll anchor (no jump on
  // "load older"). See virtuoso "Prepending Items" pattern.
  // Updated synchronously during render (set-state-during-render pattern)
  // so the new firstItemIndex is committed in the same paint as the new
  // data — avoids a one-frame flash with a stale anchor.
  const [firstItemIndex, setFirstItemIndex] = useState(VIRTUOSO_INITIAL_FIRST_INDEX);
  const [trackedFirstKey, setTrackedFirstKey] = useState<string | undefined>();
  const newFirstKey = data.length > 0 ? dataItemKey(data[0]) : undefined;
  if (newFirstKey !== trackedFirstKey) {
    if (trackedFirstKey !== undefined && newFirstKey !== undefined) {
      const idx = data.findIndex((d) => dataItemKey(d) === trackedFirstKey);
      if (idx > 0) setFirstItemIndex((prev) => prev - idx);
    }
    setTrackedFirstKey(newFirstKey);
  }

  // Lightbox needs the full image list (across all messages, not just the
  // virtualizer's mounted slice). Embed it as JSON so the provider can
  // dedup against any currently-rendered images.
  const chatImagesJson = useMemo(
    () => JSON.stringify(extractChatImages(messages, { streamText, boxSlug })),
    [messages, streamText, boxSlug],
  );

  const handleAtBottomStateChange = useCallback((b: boolean) => {
    atBottomRef.current = b;
  }, []);

  // During streaming, the tail item's height grows without changing data
  // length — followOutput won't fire — so re-pin to bottom imperatively
  // while the user is at the bottom.
  useEffect(() => {
    if (streamingShown && atBottomRef.current) {
      virtuosoRef.current?.scrollToIndex({
        index: "LAST",
        align: "end",
        behavior: "auto",
      });
    }
  }, [streamText, streamTools.length, streamingShown]);

  // Scroll to bottom when user sends a message (even if scrolled up).
  useEffect(() => {
    if (scrollToBottomTrigger > 0 && data.length > 0) {
      virtuosoRef.current?.scrollToIndex({
        index: "LAST",
        align: "end",
        behavior: "auto",
      });
    }
  }, [scrollToBottomTrigger, data.length]);

  // First time data populates after mount, jump to the latest message.
  // The Virtuoso `initialTopMostItemIndex` prop is captured on virtuoso's
  // own mount; if the parent renders the placeholder until history arrives
  // (the common case for an existing chat), Virtuoso's first commit sees
  // empty data and the later data populate doesn't re-trigger the initial
  // index. Doing it imperatively here covers that path.
  useEffect(() => {
    if (initialScrollDoneRef.current) return;
    if (data.length === 0) return;
    initialScrollDoneRef.current = true;
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      align: "end",
      behavior: "auto",
    });
  }, [data.length]);

  const headerContext = useMemo<ChatListContext>(() => ({
    hasOlder,
    loadingOlder,
    onLoadOlder,
    earlierCount: totalEntries - messages.length,
  }), [hasOlder, loadingOlder, onLoadOlder, totalEntries, messages.length]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 flex items-center justify-center text-warm-500 text-sm">
        Start a conversation with your box assistant.
      </div>
    );
  }

  const lastAssistantGroupIndex = groups.findLastIndex((g) => g.type === "assistant");

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-x-hidden">
      <div data-image-list hidden>{chatImagesJson}</div>
      <Virtuoso<DataItem, ChatListContext>
        ref={virtuosoRef}
        className="flex-1"
        data={data}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={Math.max(0, data.length - 1)}
        followOutput={(atBottom) => (atBottom ? "auto" : false)}
        atBottomStateChange={handleAtBottomStateChange}
        atBottomThreshold={80}
        computeItemKey={(_, item) => dataItemKey(item)}
        context={headerContext}
        components={{ Header: LoadOlderHeader }}
        itemContent={(_, item) => {
          if (item.kind === "marker") {
            return (
              <div className="flex justify-center py-1">
                <div className="text-[11px] text-warm-500 px-2.5 py-0.5 bg-warm-50 border border-warm-200 rounded-full">
                  {item.marker.label}
                </div>
              </div>
            );
          }
          if (item.kind === "stream") {
            return (
              <MessageErrorBoundary label="stream">
                <div className="py-0.5">
                  <StreamingMessage text={streamText} onZoomView={onZoomView} />
                  {streamTools.length > 0 ? (
                    <div className="pl-3 sm:pl-6 pr-4 sm:pr-24 pb-2">
                      <ToolList blocks={streamTools} />
                    </div>
                  ) : null}
                </div>
              </MessageErrorBoundary>
            );
          }
          if (item.kind === "processing") {
            return (
              <div className="pl-3 sm:pl-6 pr-4 sm:pr-24 py-2 text-sm text-warm-500 italic">
                Agent is processing…
              </div>
            );
          }
          if (item.kind === "pendingHq") {
            return <PendingHqMessage text={item.text} />;
          }
          const group = item.group;
          const groupIndex = item.groupIndex;
          const boundaryLabel = `${group.type}#${groupIndex}:${group.entries[0]?.uuid ?? ""}`;
          let body: ReactNode;
          if (group.type === "compaction") {
            body = <div className="py-0.5"><CompactionMessage entries={group.entries} /></div>;
          } else if (group.type === "interrupted") {
            body = <div className="py-0.5"><InterruptedMessage /></div>;
          } else if (group.type === "self-note") {
            body = (
              <div className="py-0.5">
                {group.notes.map((note, i) => (
                  <SelfNoteMessage key={i} note={note} />
                ))}
              </div>
            );
          } else if (group.type === "user") {
            body = <div className="py-0.5"><UserMessage entries={group.entries} debugView={debugView} currentUserEmail={currentUserEmail} acknowledged={item.acknowledged} /></div>;
          } else {
            body = (
              <div className="py-0.5">
                <AssistantMessage
                  entries={group.entries}
                  debugView={debugView}
                  speechPlaying={Boolean(speechPlayback.isPlaying && groupIndex === lastAssistantGroupIndex)}
                  onStopSpeech={handleStopSpeech}
                  onZoomView={onZoomView}
                  proseEnabled={proseEnabled}
                />
              </div>
            );
          }
          return <MessageErrorBoundary label={boundaryLabel}>{body}</MessageErrorBoundary>;
        }}
      />
    </div>
  );
}

/**
 * Resolve the directory a chat is bound to. Returns the prop value
 * immediately for fresh "new" landmark chats (server hasn't seen the
 * session id yet) and falls back to the persisted association for
 * resumed sessions.
 */
function useEffectiveContextDir(params: {
  sessionId: string | null;
  contextDir: string | undefined;
}): string | null {
  const query = trpc.chat.directoryFor.useQuery(
    { sessionId: params.sessionId ?? "" },
    { enabled: Boolean(params.sessionId) },
  );
  return params.contextDir ?? query.data?.contextDir ?? null;
}

/**
 * Small "Context: <dir>" link in the chat header for chats that were
 * started from a landmark.
 */
function ChatContextLink({ dir, boxSlug }: { dir: string | null; boxSlug: string }) {
  if (!dir) return null;
  return (
    <a
      href={`/${boxSlug}/browse/${dir}`}
      className="ml-3 text-xs text-white/80 hover:text-white truncate"
      title={`Context: ${dir}/`}
    >
      {dir}/
    </a>
  );
}

interface InteractiveChatProps {
  /** Either an existing session id or `"new"` for a fresh conversation. */
  sessionInput: string;
  /**
   * If set on a `"new"` chat, the chat is bound to this landmark directory.
   * Sent to the backend on the first send; the SDK spawns with `cwd` set
   * there and the association is persisted to chat-session-history. Once
   * the session id is assigned, future resumes look it up server-side.
   */
  contextDir?: string;
}

export function InteractiveChat({ sessionInput, contextDir }: InteractiveChatProps) {
  const [snapshot, send] = useSSRMachine(chatMachine, {
    input: { sessionInput, contextDir },
  });
  const { messages, pendingMessages, streamText, streamTools, error, sessionId, processRunning, processBusy, totalEntries } = snapshot.context;
  const effectiveContextDir = useEffectiveContextDir({ sessionId, contextDir });
  const isStreaming = snapshot.matches("streaming") || snapshot.matches("refreshing");
  const isLoading = snapshot.matches("loading");
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const { boxSlug } = useParams({ strict: false });

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const nextAttachmentIdRef = useRef(1);
  const [fileAttachments, setFileAttachments] = useState<FileAttachmentItem[]>([]);
  const nextFileAttachmentIdRef = useRef(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [scrollToBottomTrigger, setScrollToBottomTrigger] = useState(0);
  const [debugView, setDebugView] = useState(false);
  const [showDebugLog, setShowDebugLog] = useState(false);

  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [modelMarkers, setModelMarkers] = useState<ModelMarker[]>([]);
  const groups = useMemo(() => groupMessages(messages), [messages]);

  // Server persists the selection in .callback-box/chat-model.json;
  // read it on mount so the menu's checkmark reflects server state.
  useEffect(() => {
    if (!sessionId) return;
    getChatStatus({ sessionId })
      .then((status) => { setSelectedModel(status.model); })
      .catch(() => {});
  }, [sessionId]);

  // Chat-feature flags (narration, prose, ...). Server-side state synced via
  // /api/chat/features on mount, then kept fresh through chat-features-changed
  // events on the global SSE stream (see useSSE below).
  const [chatFeatures, setChatFeatures] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!sessionId) return;
    getChatFeatures({ sessionId })
      .then((res) => { setChatFeatures(res.features); })
      .catch(() => {});
  }, [sessionId]);
  const narrationEnabled = chatFeatures.narration === "on";

  const handleToggleNarration = useCallback(() => {
    if (!sessionId) return;
    const next = narrationEnabled ? "off" : "on";
    // Optimistic — server-confirmed value lands via the SSE event handler.
    setChatFeatures((prev) => ({ ...prev, narration: next }));
    setChatFeature({ sessionId, feature: "narration", value: next })
      .then((res) => { setChatFeatures(res.features); })
      .catch((e: unknown) => {
        console.warn(`[chatfsm] set-feature narration failed: ${e instanceof Error ? e.message : String(e)}`);
      });
  }, [sessionId, narrationEnabled]);

  const handleSelectModel = useCallback((model: string | null) => {
    if (model === selectedModel) return;
    const label = MODEL_OPTIONS.find((o) => o.model === model)?.label ?? "default";
    setModelMarkers((markers) => [
      ...markers,
      {
        id: `model-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: `Switched to ${label}`,
        afterGroupCount: groups.length,
      },
    ]);
    setSelectedModel(model);
    if (sessionId) {
      console.warn(`[chatfsm] set-model request sessionId=${sessionId} model=${model ?? "<default>"}`);
      setChatModel({ sessionId, model })
        .then((res) => {
          console.warn(`[chatfsm] set-model response model=${res.model ?? "<default>"} ok=${res.ok}`);
          // Re-sync UI to whatever the server actually persisted, in case a
          // race / bug means the request landed differently than expected.
          setSelectedModel(res.model);
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[chatfsm] set-model error: ${msg}`);
        });
    } else {
      console.warn("[chatfsm] set-model skipped — sessionId is null");
    }
  }, [selectedModel, groups.length, sessionId]);
  const [panel, setPanel] = useState<{ tabs: PanelTab[]; activePath: string | null }>({ tabs: [], activePath: null });
  const activeView = panel.activePath
    ? panel.tabs.find((t) => t.target.path === panel.activePath) ?? null
    : null;
  const [typingMode, setTypingMode] = useState(false);
  const [typingLocked, setTypingLocked] = useState(false);
  // Tracks when voice recording is paused due to TTS playback
  const [voicePaused, setVoicePaused] = useState(false);
  const voicePausedRef = useRef(false);

  const onZoomView = useCallback<OnZoomView>((view) => {
    setPanel((p) => {
      const exists = p.tabs.some((t) => t.target.path === view.target.path);
      const tabs = exists ? p.tabs : [...p.tabs, view];
      return { tabs, activePath: view.target.path };
    });
  }, []);
  const onSelectTab = useCallback((path: string) => {
    setPanel((p) => ({ ...p, activePath: path }));
  }, []);
  const onCloseTab = useCallback((path: string) => {
    setPanel((p) => {
      const idx = p.tabs.findIndex((t) => t.target.path === path);
      if (idx === -1) return p;
      const tabs = p.tabs.filter((_, i) => i !== idx);
      const activePath = p.activePath === path
        ? (tabs.length === 0 ? null : tabs[Math.min(idx, tabs.length - 1)].target.path)
        : p.activePath;
      return { tabs, activePath };
    });
  }, []);
  const onClosePanel = useCallback(() => {
    setPanel({ tabs: [], activePath: null });
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

  // Fallback for missed chat-complete SSE: while pending messages exist,
  // poll history every 5s and dispatch SET_MESSAGES so reconcile drops them
  // as the server catches up. SET_MESSAGES is a global handler — works in
  // any state without forcing a refresh transition that would disturb a
  // running stream.
  useEffect(() => {
    if (pendingMessages.length === 0) return;
    if (!sessionId) return;
    const poll = () => {
      getChatHistory({ sessionId, tail: HISTORY_TAIL, minRealUserMessages: MIN_REAL_USER_MESSAGES })
        .then((data) => {
          send({ type: "SET_MESSAGES", messages: data.entries, sessionId: data.sessionId });
        })
        .catch(() => {});
    };
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [pendingMessages.length, send, sessionId]);

  // Handle SSE events: schedule-fired, chat-history, chat-user-message,
  // chat-session-assigned. Events tagged with a sessionId are filtered to
  // this view's session only.
  useSSE(`${getEventSourceBase()}/events`, {
    onConnect: useCallback(() => {
      console.warn("[chatfsm] sse-connect");
      // Re-sync after a (re)connect: any chat-complete / chat-history events
      // we missed while disconnected won't replay if the gap exceeded the
      // event-bus retention. REFRESH is a global handler that's ignored in
      // streaming, so it's safe to dispatch unconditionally.
      send({ type: "REFRESH" });
    }, [send]),
    onDisconnect: useCallback(() => {
      console.warn("[chatfsm] sse-disconnect");
    }, []),
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
        if (data.sessionId && sessionId && data.sessionId !== sessionId) return;
        console.warn(`[chatfsm] sse-chat-history entries=${data.entries.length}`);
        send({ type: "SET_MESSAGES", messages: data.entries, sessionId: data.sessionId });
        fetchSchedules();
      } else if (event.event === "chat-complete") {
        const data = event.data as { sessionId: string | null };
        if (data.sessionId && sessionId && data.sessionId !== sessionId) return;
        console.warn("[chatfsm] sse-chat-complete");
        // Agent turn completed — refresh history to pick up the response.
        send({ type: "REFRESH" });
      } else if (event.event === "chat-user-message") {
        const data = event.data as { sessionId: string | null; message: string; user: { email: string; name: string } | null; timestamp: string };
        if (data.sessionId && sessionId && data.sessionId !== sessionId) return;
        if (data.user && currentUser && data.user.email !== currentUser.email) {
          send({
            type: "OTHER_USER_MESSAGE",
            message: data.message,
            userName: data.user.name,
            timestamp: data.timestamp,
          });
        }
      } else if (event.event === "chat-features-changed") {
        applyFeaturesChange({ data: event.data, currentSessionId: sessionId, setFeatures: setChatFeatures });
      } else if (event.event === "chat-session-assigned") {
        const data = event.data as { sessionId: string };
        // Lock the running machine onto the assigned id (so subsequent
        // sends + the post-stream refresh use it) and update the URL so a
        // reload lands on the right session. ChatPage stabilizes the React
        // key across this transition, so the in-flight stream survives —
        // remounting here would orphan the SSE listener and the chat would
        // appear empty until the user reloads.
        if (sessionInput === "new" && !sessionId) {
          send({ type: "SESSION_ASSIGNED", sessionId: data.sessionId });
          // The landmark binding (if any) is persisted by the backend in
          // `chat-session-history` when the SDK assigns the id, so we just
          // navigate to the assigned-id URL.
          navigate({
            to: href(`/${boxSlug}/chat`),
            search: { session: data.sessionId } as never,
            replace: true,
          });
        }
      }
    }, [fetchSchedules, send, currentUser, sessionId, sessionInput, navigate, boxSlug]),
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
    if (!sessionId) return;
    setLoadingOlder(true);
    // Load all history up to the current start point
    const currentCount = messages.length;
    const olderCount = totalEntries - currentCount;
    const chunkSize = Math.min(olderCount, 40);
    // Fetch a window ending just before current messages
    const offset = Math.max(0, olderCount - chunkSize);
    const limit = olderCount - offset;
    getChatHistory({ sessionId, offset, limit })
      .then((result) => {
        send({ type: "PREPEND_MESSAGES", messages: result.entries });
      })
      .catch(() => {})
      .finally(() => setLoadingOlder(false));
  }, [loadingOlder, messages.length, totalEntries, send, sessionId]);

  const doSend = useCallback(
    (wrapped: string) => {
      send({ type: "SEND", message: wrapped, messageId: newMessageId() });
    },
    [send]
  );

  const zoomedViewAttr = useCallback(() => {
    if (!activeView) return "";
    const uri = `view:${serializeViewUrl(activeView.target)}`;
    return ` zoomed-view="${uri}"`;
  }, [activeView]);

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
      const messageId = newMessageId();
      if (images.length > 0) {
        send({ type: "SEND", message: wrapped, messageId, images });
      } else {
        send({ type: "SEND", message: wrapped, messageId });
      }
    },
    [send]
  );

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text && attachments.length === 0 && fileAttachments.length === 0) return;
    turnTakingRef.current = false;
    unlockAudioContext();

    // Convert UI attachments to the wire-format images payload.
    const images: ChatImageAttachment[] = attachments.map((a) => ({
      id: a.id,
      mimeType: a.mimeType,
      dataBase64: a.dataBase64,
    }));

    const typed = `<typed local-time="${localTime()}"${zoomedViewAttr()}${timePassedAttr()}>${text}</typed>`;
    // File attachments emit a sibling <attachments> block of markdown-style
    // reference links so the agent sees the path each [fileN] token resolves
    // to without us having to inline the file's bytes anywhere.
    const attachmentsBlock = fileAttachments.length > 0
      ? "\n<attachments>\n" +
        fileAttachments.map((f) => `[file${f.id}]: ${f.path}`).join("\n") +
        "\n</attachments>"
      : "";
    const wrapped = typed + attachmentsBlock;

    // Release the object URLs after send — the base64 payload is independent
    // of the object URL, so dropping them doesn't affect the message.
    for (const a of attachments) {
      try { URL.revokeObjectURL(a.objectUrl); } catch { /* already revoked */ }
    }
    setAttachments([]);
    nextAttachmentIdRef.current = 1;
    setFileAttachments([]);
    nextFileAttachmentIdRef.current = 1;

    setInput("");
    doSendWithImages(wrapped, images);
    setScrollToBottomTrigger((n) => n + 1);
    if (typingMode && !typingLocked) {
      setTypingMode(false);
    }
  }, [input, attachments, fileAttachments, doSendWithImages, zoomedViewAttr, timePassedAttr, typingMode, typingLocked]);

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

  /**
   * Upload picked files to the box's tmp/ dir, then add them to the
   * attachment row and insert `[fileN]` tokens at the textarea cursor.
   * Mirrors addImageFiles but the upload happens server-side; we just track
   * the returned path.
   */
  const addFileUploads = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    const uploaded = await Promise.all(
      files.map(async (f) => {
        try {
          return await uploadChatFile(f);
        } catch (e) {
          console.error("[chat] Failed to upload file:", e);
          return null;
        }
      })
    );

    const newItems: FileAttachmentItem[] = [];
    for (const u of uploaded) {
      if (!u) continue;
      newItems.push({
        id: nextFileAttachmentIdRef.current++,
        path: u.path,
        originalName: u.originalName,
        size: u.size,
        mimetype: u.mimetype,
      });
    }
    if (newItems.length === 0) return;

    setFileAttachments((prev) => [...prev, ...newItems]);

    // Always trail a space so the user can keep typing after the token, and
    // always focus the textarea — the upload is triggered from a menu, so
    // focus is on the menu button, not the composer.
    const tokens = newItems.map((f) => `[file${f.id}]`).join(" ") + " ";
    const ta = textareaRef.current;
    const taFocused = ta !== null && document.activeElement === ta;
    const selStart = taFocused && ta.selectionStart !== null ? ta.selectionStart : input.length;
    const selEnd = taFocused && ta.selectionEnd !== null ? ta.selectionEnd : selStart;
    const before = input.slice(0, selStart);
    const after = input.slice(selEnd);
    const pad = before.length > 0 && !/\s$/.test(before) ? " " : "";
    setInput(before + pad + tokens + after);
    const cursorAt = (before + pad + tokens).length;
    requestAnimationFrame(() => {
      if (ta !== null && ta.isConnected) {
        ta.focus();
        ta.setSelectionRange(cursorAt, cursorAt);
      }
    });
  }, [input]);

  const handleAttachFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    void addFileUploads(files);
  }, [addFileUploads]);

  const removeFileAttachment = useCallback((id: number) => {
    setFileAttachments((prev) => prev.filter((f) => f.id !== id));
    setInput((prev) =>
      prev
        .replace(/\s?\[file(\d+)]\s?/g, (match, n: string) =>
          parseInt(n, 10) === id ? " " : match
        )
        .replace(/ {2,}/g, " ")
    );
  }, []);

  const handleInterrupt = useCallback(() => {
    send({ type: "INTERRUPT" });
  }, [send]);

  const handleNewSession = useCallback(() => {
    const search: { session: string; contextDir?: string } = { session: "new" };
    // Propagate the binding even when it's the empty-string root binding,
    // so a fresh chat from a root-bound session stays root-bound rather
    // than becoming an unbound legacy chat.
    if (effectiveContextDir !== null) search.contextDir = effectiveContextDir;
    navigate({
      to: href(`/${boxSlug}/chat`),
      search: search as never,
    });
  }, [navigate, boxSlug, effectiveContextDir]);

  const handleStopProcess = useCallback(() => {
    send({ type: "INTERRUPT" });
  }, [send]);

  const handleRestartProcess = useCallback(() => {
    if (!sessionId) return;
    restartChatSubprocess({ sessionId }).catch(() => {});
  }, [sessionId]);

  const handleCompactSession = useCallback(() => {
    // /compact must be the first characters of the text, with no wrapping —
    // the backend /send route detects leading-slash messages and skips
    // user-attr + pending-schedules injection.
    send({ type: "SEND", message: "/compact", messageId: newMessageId() });
  }, [send]);

  // Realtime transcription with voice keyword spotting. `wantAudioBlob`
  // is a predicate read at keyword-fire time so a mid-session toggle of
  // narration takes effect on the next send.
  const narrationEnabledRef = useRef(narrationEnabled);
  useEffect(() => { narrationEnabledRef.current = narrationEnabled; });
  const [hqInFlight, setHqInFlight] = useState(false);
  // Realtime transcript shown as a pending user-message bubble while the
  // HQ pass runs. Null when no narration submit is in flight. Driven by
  // the same lifecycle as hqInFlight but carries the text to render.
  const [pendingHqDraft, setPendingHqDraft] = useState<string | null>(null);
  const transcription = useRealtimeTranscription({
    wantAudioBlob: () => narrationEnabledRef.current,
    onKeywordSend: (text, audioBlob) => {
      if (!text.trim()) {
        transcription.start();
        return;
      }
      sendSound.play();
      stopTickRef.current = tick.repeatPlay(1000, 30000);
      // Narration mode swaps in a high-quality transcription before sending
      // to the agent — the realtime text is good enough for the live UI
      // but accuracy matters more for the persistent record.
      const submit = (finalText: string) => {
        doSend(`<speech local-time="${localTime()}"${zoomedViewAttr()}${timePassedAttr()}>${finalText}</speech>`);
      };
      if (narrationEnabledRef.current && audioBlob) {
        setHqInFlight(true);
        setPendingHqDraft(text);
        void postAudioForHqTranscription(audioBlob)
          .then((hqText) => {
            // Clear the pending bubble before submit so it doesn't overlap
            // with the real user message about to land in the chat history.
            setPendingHqDraft(null);
            if (hqText === null) {
              console.warn("[hq-transcribe] returned null — falling back to realtime");
              submit(text);
              return;
            }
            // Re-run keyword detection on the HQ text so the agent sees the
            // send-message (or other) keyword as a pill, not plain words.
            // If HQ misheard the keyword entirely, just submit the raw text.
            const keyword = detectKeyword(hqText);
            submit(keyword ? keyword.processedTranscript : hqText);
          })
          .finally(() => { setHqInFlight(false); });
      } else {
        if (narrationEnabledRef.current) {
          console.warn("[hq-transcribe] narration enabled but no audioBlob — submitting realtime text");
        }
        submit(text);
      }
      // Restart recording so the user can keep talking
      transcription.start();
    },
    onKeywordCancel: () => {
      transcription.cancel();
    },
    onKeywordMicOff: () => {
      turnTakingRef.current = false;
      recordingStop.play();
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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isTranscribing) {
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "j" && e.ctrlKey) {
        e.preventDefault();
        const ta = textareaRef.current;
        if (ta) {
          const { selectionStart, selectionEnd, value } = ta;
          const newValue = value.slice(0, selectionStart) + "\n" + value.slice(selectionEnd);
          setInput(newValue);
          requestAnimationFrame(() => {
            ta.selectionStart = ta.selectionEnd = selectionStart + 1;
          });
        }
      }
    },
    [handleSend, isTranscribing, textareaRef, setInput]
  );

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
    recordingStop.play();
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
    <div className={`h-full flex ${activeView ? "flex-col md:flex-row" : "flex-col"} bg-gradient-to-b from-warm-50 to-warm-200 overflow-hidden`}>
      {activeView ? (
        <CompanionViewPanel
          tabs={panel.tabs}
          activePath={activeView.target.path}
          onSelectTab={onSelectTab}
          onCloseTab={onCloseTab}
          onClosePanel={onClosePanel}
          onNavigate={(target, hint) => onZoomView({
            target: { ...target, zoom: false },
            label: hint && hint.label ? hint.label : target.path,
          })}
        />
      ) : null}
    <div className="flex-1 flex flex-col min-h-0 min-w-0 max-w-5xl w-full mx-auto">
      {/* Header with debug controls */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-accent via-coral to-primary">
        <h2 className="text-sm font-semibold text-white tracking-wide">Chat</h2>
        <ChatContextLink dir={effectiveContextDir} boxSlug={boxSlug ?? ""} />
        <NarrationStatusBadge enabled={narrationEnabled} hqInFlight={hqInFlight} onTurnOff={handleToggleNarration} />
        <div className="flex-1" />
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
          onRestartProcess={handleRestartProcess}
          onCompactSession={handleCompactSession}
          sessionId={sessionId}
          running={processRunning}
          busy={isStreaming}
          debugView={debugView}
          onToggleDebugView={() => setDebugView((v) => !v)}
          showDebugLog={showDebugLog}
          onToggleDebugLog={() => setShowDebugLog((v) => !v)}
          selectedModel={selectedModel}
          onSelectModel={handleSelectModel}
          narrationEnabled={narrationEnabled}
          onToggleNarration={handleToggleNarration}
        />
      </div>
      {/* Messages area — virtualized */}
      <VirtualizedMessageList
        messages={messages}
        groups={groups}
        modelMarkers={modelMarkers}
        isStreaming={isStreaming}
        streamText={streamText}
        streamTools={streamTools}
        processingShown={Boolean(processBusy) && !isStreaming}
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
        proseEnabled={chatFeatures.prose !== "off"}
        pendingHqDraft={pendingHqDraft}
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

      {/* Queued-message indicator: visible whenever the agent is busy with
          a previous turn and one or more user messages are sitting in the
          backend queue waiting to be processed. Without this the UI looks
          idle even though work is pending. */}
      {pendingMessages.length > 0 ? (
        <div className="px-4 py-1.5 border-t border-info-light bg-info-50 text-info-dark text-xs">
          Agent is busy — {pendingMessages.length === 1 ? "your message is queued" : `${pendingMessages.length} messages are queued`}
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

      {/* File attachment panel: chips for non-image uploads */}
      <FileAttachmentPanel attachments={fileAttachments} onRemove={removeFileAttachment} />

      {/* Hidden file input — opened by the "+" attach button. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

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
          onAttachFiles={handleAttachFiles}
          narrationEnabled={narrationEnabled}
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

/**
 * Dev-only gallery for the chat composer's visual states.
 *
 * Renders the REAL presentational composer (ChatInputArea + MobileTextareaRow +
 * the header chips) with fabricated props, so the voice states that normally
 * need a live mic / TTS (recording, pausedForSpeech, speaking, streaming, HQ in
 * flight) can be captured deterministically. Because the components take all
 * state as props, no machine or microphone is involved.
 *
 * Drive one state at a time with `?state=<name>` for a clean capture; omit it
 * to see the whole gallery stacked. Screenshot at a desktop width for the
 * desktop bar, at a phone width for the mobile bar + drop-up row.
 *
 * Not part of the product — only mounted under /dev/composer-states in dev
 * builds (see router.tsx). Prop-typed against the real components, so it breaks
 * the typecheck if their contracts change — which keeps it honest.
 */

import { useRef } from "react";
import { ChatInputArea, type TranscriptionHandle } from "../../../components/chat/InteractiveChat-composer";
import { MobileTextareaRow } from "../../../components/chat/InteractiveChat-mobile-row";
import { NarrationStatusBadge, MuteButton } from "../../../components/chat/InteractiveChat-controls";

interface StateSpec {
  label: string;
  /** Fabricated props that differ from the idle baseline. */
  input?: string;
  isTranscribing?: boolean;
  transcript?: string;
  speechPlaying?: boolean;
  voicePaused?: boolean;
  isStreaming?: boolean;
  narrationEnabled?: boolean;
  /** Header chips. */
  badge?: boolean;
  hqInFlight?: boolean;
  muted?: boolean;
  /** Render the mobile drop-up textarea row (as ChatComposerSection does when typing/transcribing). */
  mobileRow?: boolean;
}

const STATES: Record<string, StateSpec> = {
  idle: { label: "Idle, empty" },
  typing: { label: "Typing (Send enabled)", input: "Remind me to water the plants tomorrow" },
  recording: { label: "Recording (transcript)", isTranscribing: true, transcript: "remind me to water the plants tomorrow", mobileRow: true },
  "recording-empty": { label: "Recording (Listening…)", isTranscribing: true, transcript: "", mobileRow: true },
  paused: { label: "Paused for speech", voicePaused: true, speechPlaying: true },
  speaking: { label: "Speaking (not paused)", speechPlaying: true },
  streaming: { label: "Agent streaming", isStreaming: true },
  "speaking-streaming": { label: "Speaking + streaming", speechPlaying: true, isStreaming: true },
  "narration-idle": { label: "Narration, idle", narrationEnabled: true, badge: true },
  "narration-hq": { label: "Narration, HQ in flight", narrationEnabled: true, badge: true, hqInFlight: true },
  muted: { label: "Muted", muted: true },
};

function noop() {}

function StateBlock({ spec }: { spec: StateSpec }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const transcription: TranscriptionHandle = {
    transcript: spec.transcript ?? "",
    start: noop,
    stop: () => Promise.resolve(spec.transcript ?? ""),
    cancel: noop,
  };
  const inputAreaProps = {
    textareaRef,
    input: spec.input ?? "",
    setInput: noop,
    isTranscribing: spec.isTranscribing ?? false,
    transcription,
    handleKeyDown: noop,
    handleSend: noop,
    handleCancelTranscription: noop,
    clearDraft: noop,
    onKeyboard: noop,
    onVoice: noop,
    speechPlaying: spec.speechPlaying ?? false,
    onStopSpeech: noop,
    isStreaming: spec.isStreaming ?? false,
    onInterrupt: noop,
    onStopDictation: noop,
    doSend: noop,
    zoomedViewAttr: () => "",
    timePassedAttr: () => "",
    voicePaused: spec.voicePaused ?? false,
    onUnpause: noop,
    onAttachFiles: noop,
    narrationEnabled: spec.narrationEnabled ?? false,
  };
  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* Faux header strip so narration badge / mute icon read in context. */}
      <header className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-accent via-coral to-primary">
        <h1 className="text-sm font-semibold text-white tracking-wide">Chat</h1>
        <NarrationStatusBadge enabled={spec.badge ?? false} hqInFlight={spec.hqInFlight ?? false} onTurnOff={noop} />
        <div className="flex-1" />
        <MuteButton muted={spec.muted ?? false} onToggle={noop} />
      </header>
      <ChatInputArea {...inputAreaProps} />
      {spec.mobileRow ? (
        <div className="sm:hidden bg-gradient-to-r from-warm-100 via-warm-100 to-warm-200 px-3 pb-2">
          <MobileTextareaRow
            input={spec.input ?? ""}
            setInput={noop}
            isTranscribing={spec.isTranscribing ?? false}
            transcription={transcription}
            handleSend={noop}
            handleCancelTranscription={noop}
            clearDraft={noop}
            onStopDictation={noop}
            doSend={noop}
            zoomedViewAttr={() => ""}
            timePassedAttr={() => ""}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ComposerStatesHarness() {
  const selected = new URLSearchParams(window.location.search).get("state");
  const entries = selected && STATES[selected] ? [[selected, STATES[selected]] as const] : Object.entries(STATES);
  return (
    <div className="min-h-screen bg-gradient-to-b from-warm-50 to-warm-200 py-4">
      {entries.map(([key, spec]) => (
        <div key={key} data-state={key} className="mb-8">
          {selected ? null : (
            <div className="max-w-5xl mx-auto px-4 pb-1 text-xs font-mono text-warm-500">{key} — {spec.label}</div>
          )}
          <StateBlock spec={spec} />
        </div>
      ))}
    </div>
  );
}

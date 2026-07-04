/**
 * Dev-only gallery for the chat composer's visual states.
 *
 * Renders the REAL composer section (ChatComposerSection, which owns the mobile
 * keyboard block with its lock/close affordances, wrapping the real
 * ChatInputArea + MobileTextareaRow + header chips) with fabricated props, so
 * the states that normally need a live mic / TTS can be inspected
 * deterministically — no machine or microphone involved. Because the components
 * take all state as props, this stays prop-typed against them and breaks the
 * typecheck if their contracts change.
 *
 * It does NOT hand-pick states — it declares the axes and renders the
 * cross-product, filtering the impossible combos (showing why):
 *   - button bar:  mode × narration × muted × streaming
 *   - mobile keyboard: typingMode (unlocked / locked) × input (empty / typed)
 * `?state=<key>` isolates one combo for a clean capture; omit it for the whole
 * exploded grid + the impossible list.
 *
 * Mobile-only states (the recording drop-up row, the keyboard block) only
 * differ at a narrow viewport — view the gallery at phone width to see them.
 *
 * Not part of the product — only mounted under /dev/composer-states in dev
 * builds (see router.tsx).
 */

import { useRef } from "react";
import { ChatInputArea, type TranscriptionHandle } from "../../../components/chat/InteractiveChat-composer";
import { MobileTextareaRow } from "../../../components/chat/InteractiveChat-mobile-row";
import { ChatComposerSection } from "../../../components/chat/InteractiveChat-layout";
import { NarrationStatusBadge, MuteButton } from "../../../components/chat/InteractiveChat-controls";
import { TargetStrip } from "../../../components/chat/TargetStrip";
import { chatTargetStatus } from "../../../input/targets/chat-target";
import { InputStoreProvider, type InputStore } from "../../../components/chat/input-store";

// --- Axes ---

type Mode = "idle" | "typing" | "recording" | "paused" | "speaking";
const MODES: Mode[] = ["idle", "typing", "recording", "paused", "speaking"];
const MODE_LABEL: Record<Mode, string> = {
  idle: "Idle",
  typing: "Typing",
  recording: "Recording",
  paused: "Paused for speech",
  speaking: "Speaking",
};

type Keyboard = "closed" | "unlocked" | "locked";

interface Combo {
  mode: Mode;
  narration: boolean;
  muted: boolean;
  streaming: boolean;
  keyboard: Keyboard;
  /** Recording before any words arrive ("Listening…", Send disabled). */
  emptyTranscript?: boolean;
}

const SAMPLE_TRANSCRIPT = "remind me to water the plants tomorrow";
const SAMPLE_INPUT = "Remind me to water the plants tomorrow";

/** Why this combo can't occur in practice, or null if it's realizable. */
function impossibleReason(c: Combo): string | null {
  if (c.muted && (c.mode === "paused" || c.mode === "speaking")) {
    return "muted suppresses TTS (markPlayed), so speech never plays — the speaking / paused states are unreachable while muted";
  }
  return null;
}

function comboKey(c: Combo): string {
  const kb = c.keyboard === "unlocked" ? "keyboard" : c.keyboard === "locked" ? "keyboard-locked" : "";
  return [c.mode, c.emptyTranscript === true ? "empty" : "", c.narration ? "narration" : "", c.muted ? "muted" : "", c.streaming ? "streaming" : "", kb]
    .filter(Boolean)
    .join("-");
}

function comboLabel(c: Combo): string {
  const kb = c.keyboard === "unlocked" ? "keyboard (unlocked)" : c.keyboard === "locked" ? "keyboard (locked)" : "";
  const tags = [c.emptyTranscript === true ? "no words yet" : "", c.narration ? "narration" : "", c.muted ? "muted" : "", c.streaming ? "streaming" : "", kb].filter(Boolean);
  return MODE_LABEL[c.mode] + (tags.length > 0 ? ` · ${tags.join(" · ")}` : "");
}

/**
 * The realizable axis cross-product, in two families:
 *   - button bar (keyboard closed): mode × narration × muted × streaming
 *   - mobile keyboard (open): the bar is hidden, so only the textarea row +
 *     lock/close show — narration/muted/streaming/voice don't affect it. Only
 *     input-present (idle vs typing) and the lock matter.
 */
function allCombos(): Combo[] {
  const out: Combo[] = [];
  for (const mode of MODES) {
    for (const narration of [false, true]) {
      for (const muted of [false, true]) {
        for (const streaming of [false, true]) {
          out.push({ mode, narration, muted, streaming, keyboard: "closed" });
        }
      }
    }
  }
  for (const keyboard of ["unlocked", "locked"] as const) {
    for (const mode of ["idle", "typing"] as const) {
      out.push({ mode, narration: false, muted: false, streaming: false, keyboard });
    }
  }
  // Recording before any words ("Listening…") — Send is disabled here.
  out.push({ mode: "recording", narration: false, muted: false, streaming: false, keyboard: "closed", emptyTranscript: true });
  return out;
}

function specFor(c: Combo) {
  const isTranscribing = c.mode === "recording";
  return {
    input: c.mode === "typing" ? SAMPLE_INPUT : "",
    isTranscribing,
    transcript: isTranscribing && c.emptyTranscript !== true ? SAMPLE_TRANSCRIPT : "",
    speechPlaying: c.mode === "paused" || c.mode === "speaking",
    voicePaused: c.mode === "paused",
    isStreaming: c.streaming,
    narrationEnabled: c.narration,
    badge: c.narration,
    muted: c.muted,
    typingMode: c.keyboard !== "closed",
    typingLocked: c.keyboard === "locked",
  };
}

type Spec = ReturnType<typeof specFor>;

function noop() {}

function StateBlock({ spec }: { spec: Spec }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Static store for the gallery: the value never changes (set is a no-op,
  // nothing ever subscribes), it just feeds the fabricated `input` text in.
  const inputStore: InputStore = { get: () => spec.input, set: noop, subscribe: () => noop };
  const transcription: TranscriptionHandle = {
    state: spec.isTranscribing ? "recording" : "idle",
    transcript: spec.transcript,
    start: noop,
    stop: () => Promise.resolve(spec.transcript),
    cancel: noop,
  };
  const targetBusy = chatTargetStatus({ isStreaming: spec.isStreaming, processBusy: false }).state === "busy";
  const inputArea = (
    <ChatInputArea
      hideMobile={spec.typingMode}
      textareaRef={textareaRef}
      isTranscribing={spec.isTranscribing}
      transcription={transcription}
      targetBusy={targetBusy}
      handleKeyDown={noop}
      handleSend={noop}
      handleCancelTranscription={noop}
      clearDraft={noop}
      onKeyboard={noop}
      onVoice={noop}
      onStopDictation={noop}
      onVoiceSegmentSend={noop}
      voicePaused={spec.voicePaused}
      onUnpause={noop}
      onAttachFiles={noop}
      narrationEnabled={spec.narrationEnabled}
    />
  );
  const mobileRow = (
    <MobileTextareaRow
      isTranscribing={spec.isTranscribing}
      transcription={transcription}
      targetBusy={targetBusy}
      handleSend={noop}
      handleCancelTranscription={noop}
      clearDraft={noop}
      onStopDictation={noop}
      onVoiceSegmentSend={noop}
    />
  );
  const targetStrip = (
    <TargetStrip
      status={chatTargetStatus({ isStreaming: spec.isStreaming, processBusy: false })}
      pendingCount={0}
      isStreaming={spec.isStreaming}
      onInterrupt={noop}
      speechPlaying={spec.speechPlaying}
      onStopSpeech={noop}
    />
  );
  return (
    <InputStoreProvider value={inputStore}>
    <div className="w-full max-w-5xl mx-auto">
      {/* Faux header strip so narration badge / mute icon read in context. */}
      <header className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-accent via-coral to-primary">
        <h1 className="text-sm font-semibold text-white tracking-wide">Chat</h1>
        <NarrationStatusBadge enabled={spec.badge} hqInFlight={false} onToggle={noop} />
        <div className="flex-1" />
        <MuteButton muted={spec.muted} onToggle={noop} />
      </header>
      {targetStrip}
      <ChatComposerSection
        attachments={[]}
        pendingImageCount={0}
        fileAttachments={[]}
        selections={[]}
        onRemoveAttachment={noop}
        onRemoveFileAttachment={noop}
        onRemoveSelection={noop}
        fileInputRef={fileInputRef}
        onFileInputChange={noop}
        typingMode={spec.typingMode}
        typingLocked={spec.typingLocked}
        setTypingMode={noop}
        setTypingLocked={noop}
        isTranscribing={spec.isTranscribing}
        recoveredDictation={null}
        inputArea={inputArea}
        mobileRow={mobileRow}
      />
    </div>
    </InputStoreProvider>
  );
}

export function ComposerStatesHarness() {
  const selected = new URLSearchParams(window.location.search).get("state");
  const combos = allCombos();
  const realizable = combos.filter((c) => impossibleReason(c) === null);
  const impossible = combos.filter((c) => impossibleReason(c) !== null);

  if (selected) {
    const c = realizable.find((x) => comboKey(x) === selected);
    if (!c) return <div className="p-6 font-mono text-sm text-warm-600">Unknown state: {selected}</div>;
    return (
      <div className="min-h-screen bg-gradient-to-b from-warm-50 to-warm-200 py-4">
        <StateBlock spec={specFor(c)} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-warm-50 to-warm-200 py-4">
      <div className="max-w-5xl mx-auto px-4 pb-2 text-sm text-warm-700">
        <strong>{realizable.length}</strong> realizable combinations (button bar:
        mode × narration × muted × streaming; plus mobile keyboard: open ×
        lock × input). <strong>{impossible.length}</strong> filtered as impossible
        (below). Mobile-only states (recording row, keyboard block) need a phone-width viewport.
      </div>
      {realizable.map((c) => (
        <div key={comboKey(c)} data-state={comboKey(c)} className="mb-8">
          <div className="max-w-5xl mx-auto px-4 pb-1 text-xs font-mono text-warm-500">
            {comboKey(c)} — {comboLabel(c)}
          </div>
          <StateBlock spec={specFor(c)} />
        </div>
      ))}
      <div className="max-w-5xl mx-auto px-4 pt-4 mt-4 border-t border-warm-300">
        <div className="text-sm font-semibold text-warm-700 mb-2">Impossible combinations (filtered)</div>
        <ul className="text-xs text-warm-600 space-y-1">
          {impossible.map((c) => (
            <li key={comboKey(c)}>
              <span className="font-mono text-warm-500">{comboLabel(c)}</span> — {impossibleReason(c)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

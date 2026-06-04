/**
 * Dev-only gallery for the chat composer's visual states.
 *
 * Renders the REAL presentational composer (ChatInputArea + MobileTextareaRow +
 * the header chips) with fabricated props, so the voice states that normally
 * need a live mic / TTS can be inspected deterministically — no machine or
 * microphone involved. Because the components take all state as props, this
 * stays prop-typed against them and breaks the typecheck if their contracts
 * change.
 *
 * It does NOT hand-pick states — it declares the axes (primary mode × narration
 * × muted × streaming), takes the full cross-product, filters the impossible
 * combos (showing why), and renders every survivor. `?state=<key>` isolates one
 * combo for a clean capture; omit it for the whole exploded grid + the
 * impossible list.
 *
 * Not part of the product — only mounted under /dev/composer-states in dev
 * builds (see router.tsx).
 */

import { useRef } from "react";
import { ChatInputArea, type TranscriptionHandle } from "../../../components/chat/InteractiveChat-composer";
import { MobileTextareaRow } from "../../../components/chat/InteractiveChat-mobile-row";
import { NarrationStatusBadge, MuteButton } from "../../../components/chat/InteractiveChat-controls";

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

interface Combo {
  mode: Mode;
  narration: boolean;
  muted: boolean;
  streaming: boolean;
}

const SAMPLE_TRANSCRIPT = "remind me to water the plants tomorrow";

/** Why this combo can't occur in practice, or null if it's realizable. */
function impossibleReason(c: Combo): string | null {
  if (c.muted && (c.mode === "paused" || c.mode === "speaking")) {
    return "muted suppresses TTS (markPlayed), so speech never plays — the speaking / paused states are unreachable while muted";
  }
  return null;
}

function comboKey(c: Combo): string {
  return [c.mode, c.narration ? "narration" : "", c.muted ? "muted" : "", c.streaming ? "streaming" : ""]
    .filter(Boolean)
    .join("-");
}

function comboLabel(c: Combo): string {
  const tags = [c.narration ? "narration" : "", c.muted ? "muted" : "", c.streaming ? "streaming" : ""].filter(Boolean);
  return MODE_LABEL[c.mode] + (tags.length > 0 ? ` · ${tags.join(" · ")}` : "");
}

function allCombos(): Combo[] {
  const out: Combo[] = [];
  for (const mode of MODES) {
    for (const narration of [false, true]) {
      for (const muted of [false, true]) {
        for (const streaming of [false, true]) {
          out.push({ mode, narration, muted, streaming });
        }
      }
    }
  }
  return out;
}

function specFor(c: Combo) {
  const isTranscribing = c.mode === "recording";
  return {
    input: c.mode === "typing" ? "Remind me to water the plants tomorrow" : "",
    isTranscribing,
    transcript: isTranscribing ? SAMPLE_TRANSCRIPT : "",
    speechPlaying: c.mode === "paused" || c.mode === "speaking",
    voicePaused: c.mode === "paused",
    isStreaming: c.streaming,
    narrationEnabled: c.narration,
    badge: c.narration,
    muted: c.muted,
    mobileRow: isTranscribing,
  };
}

type Spec = ReturnType<typeof specFor>;

function noop() {}

function StateBlock({ spec }: { spec: Spec }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const transcription: TranscriptionHandle = {
    transcript: spec.transcript,
    start: noop,
    stop: () => Promise.resolve(spec.transcript),
    cancel: noop,
  };
  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* Faux header strip so narration badge / mute icon read in context. */}
      <header className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-accent via-coral to-primary">
        <h1 className="text-sm font-semibold text-white tracking-wide">Chat</h1>
        <NarrationStatusBadge enabled={spec.badge} hqInFlight={false} onTurnOff={noop} />
        <div className="flex-1" />
        <MuteButton muted={spec.muted} onToggle={noop} />
      </header>
      <ChatInputArea
        textareaRef={textareaRef}
        input={spec.input}
        setInput={noop}
        isTranscribing={spec.isTranscribing}
        transcription={transcription}
        handleKeyDown={noop}
        handleSend={noop}
        handleCancelTranscription={noop}
        clearDraft={noop}
        onKeyboard={noop}
        onVoice={noop}
        speechPlaying={spec.speechPlaying}
        onStopSpeech={noop}
        isStreaming={spec.isStreaming}
        onInterrupt={noop}
        onStopDictation={noop}
        doSend={noop}
        zoomedViewAttr={() => ""}
        timePassedAttr={() => ""}
        voicePaused={spec.voicePaused}
        onUnpause={noop}
        onAttachFiles={noop}
        narrationEnabled={spec.narrationEnabled}
      />
      {spec.mobileRow ? (
        <div className="sm:hidden bg-gradient-to-r from-warm-100 via-warm-100 to-warm-200 px-3 pb-2">
          <MobileTextareaRow
            input={spec.input}
            setInput={noop}
            isTranscribing={spec.isTranscribing}
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
        <strong>{realizable.length}</strong> realizable button-bar combinations
        (mode × narration × muted × streaming). <strong>{impossible.length}</strong> filtered as
        impossible (below).
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

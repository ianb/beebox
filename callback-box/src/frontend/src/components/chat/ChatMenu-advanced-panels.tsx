/**
 * `ChatMenu`'s "Advanced" sub-panel and its two nested sub-panels (Model,
 * Voice settings) — split out of ChatMenu.tsx to keep that file under the
 * 300-line cap. Chunk 3 of docs/plans/chat-header-chips.md moves Model and
 * Voice settings out to the voice chip; until then they stay reachable
 * through Advanced.
 */

import { MenuItem, MenuDivider } from "../ui/Dropdown";
import { MODEL_OPTIONS } from "./InteractiveChat-helpers";

export type TranscriptionServiceOption = "voxtral" | "deepgram" | "whisper" | "openai-realtime";
export type HqTranscriptionOption = "whisper" | "whisper-llm" | "whisper-llm-mini" | "voxtral" | "voxtral-diarized";

const TRANSCRIPTION_OPTIONS: ReadonlyArray<{
  label: string;
  service: TranscriptionServiceOption;
}> = [
  { label: "Voxtral (Mistral)", service: "voxtral" },
  { label: "Deepgram", service: "deepgram" },
  { label: "OpenAI Realtime Whisper", service: "openai-realtime" },
];

const HQ_TRANSCRIPTION_OPTIONS: ReadonlyArray<{
  label: string;
  service: HqTranscriptionOption;
}> = [
  { label: "Whisper (OpenAI)", service: "whisper" },
  { label: "Whisper LLM", service: "whisper-llm" },
  { label: "Whisper LLM mini", service: "whisper-llm-mini" },
  { label: "Voxtral (Mistral)", service: "voxtral" },
  { label: "Voxtral + diarization", service: "voxtral-diarized" },
];

/**
 * "Advanced" sub-panel: debug toggles, model/voice submenu links (moved to
 * the voice chip in chunk 3), and process controls + status footer.
 */
export function AdvancedPanel({
  onBack,
  debugView,
  onToggleDebugView,
  narrationEnabled,
  onToggleNarration,
  currentModelLabel,
  onOpenModel,
  onOpenVoice,
  showDebugLog,
  onToggleDebugLog,
  onCompactSession,
  busy,
  onRestartProcess,
  onStopProcess,
  running,
  sessionId,
}: {
  onBack: () => void;
  debugView: boolean;
  onToggleDebugView: () => void;
  narrationEnabled: boolean;
  onToggleNarration: () => void;
  currentModelLabel: string;
  onOpenModel: () => void;
  onOpenVoice: () => void;
  showDebugLog: boolean;
  onToggleDebugLog: () => void;
  onCompactSession: () => void;
  busy: boolean;
  onRestartProcess: () => void;
  onStopProcess: () => void;
  running: boolean;
  sessionId: string | null;
}) {
  return (
    <>
      <MenuItem onClick={onBack} keepOpen>
        <span className="text-warm-500">‹ Advanced</span>
      </MenuItem>
      <MenuDivider />
      <MenuItem onClick={onToggleDebugView}>{debugView ? "✓ " : "  "}Debug View</MenuItem>
      <MenuItem onClick={onToggleNarration}>
        {narrationEnabled ? "✓ " : "  "}Narration mode
      </MenuItem>
      <MenuDivider />
      <MenuItem onClick={onOpenModel} keepOpen>
        <span className="flex justify-between gap-2 w-full">
          <span>Model</span>
          <span className="text-warm-500 truncate">{currentModelLabel} ›</span>
        </span>
      </MenuItem>
      <MenuItem onClick={onOpenVoice} keepOpen>
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
    </>
  );
}

/** "Model" sub-panel, nested under "Advanced". */
export function ModelPanel({
  onBack,
  selectedModel,
  onSelectModel,
}: {
  onBack: () => void;
  selectedModel: string | null;
  onSelectModel: (model: string | null) => void;
}) {
  return (
    <>
      <MenuItem onClick={onBack} keepOpen>
        <span className="text-warm-500">‹ Model</span>
      </MenuItem>
      <MenuDivider />
      {MODEL_OPTIONS.map((opt) => (
        <MenuItem key={opt.label} onClick={() => onSelectModel(opt.model)}>
          {selectedModel === opt.model ? "✓ " : "  "}{opt.label}
        </MenuItem>
      ))}
    </>
  );
}

/** "Voice settings" sub-panel, nested under "Advanced". */
export function VoicePanel({
  onBack,
  currentService,
  onSelectTranscriptionService,
  currentHqService,
  onSelectHqTranscriptionService,
}: {
  onBack: () => void;
  /** Comparison-only — may be "fake" (dev/test service) which never appears in the option lists. */
  currentService: string | null;
  onSelectTranscriptionService: (service: TranscriptionServiceOption) => Promise<void>;
  /** Comparison-only — may be "fake" (dev/test service) which never appears in the option lists. */
  currentHqService: string | null;
  onSelectHqTranscriptionService: (hqService: HqTranscriptionOption) => Promise<void>;
}) {
  return (
    <>
      <MenuItem onClick={onBack} keepOpen>
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
    </>
  );
}

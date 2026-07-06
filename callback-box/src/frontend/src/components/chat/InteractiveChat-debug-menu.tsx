/**
 * The chat header's debug dropdown menu: toggles (debug view, narration,
 * debug log), a model submenu, and a voice-settings submenu wired to the
 * transcription tRPC config. Self-contained — props in, callbacks out.
 */

import { useState } from "react";
import { Dropdown, MenuItem, MenuDivider } from "../ui/Dropdown";
import { trpc } from "../../lib/trpc";
import { MODEL_OPTIONS } from "./InteractiveChat-helpers";

type TranscriptionServiceOption = "voxtral" | "deepgram" | "whisper" | "openai-realtime";
type HqTranscriptionOption = "whisper" | "whisper-llm" | "whisper-llm-mini" | "voxtral" | "voxtral-diarized";

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
 * Debug dropdown menu for chat controls.
 */
export function ChatDebugMenu({
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
      void utils.transcription.config.invalidate();
    } catch (e) {
      console.error("[chat] Failed to set transcription service", e);
    }
  };

  const onSelectHqTranscriptionService = async (hqService: HqTranscriptionOption) => {
    if (currentHqService === hqService) return;
    try {
      await setHqTranscriptionService.mutateAsync({ hqService });
      void utils.transcription.config.invalidate();
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
      <MenuItem onClick={onToggleNarration}>
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

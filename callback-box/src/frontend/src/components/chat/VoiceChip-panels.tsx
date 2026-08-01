/**
 * `VoiceChip`'s two sub-panels (Model, Voice settings) — split out of
 * VoiceChip.tsx to keep that file under the 300-line cap. Moved here from
 * `ChatMenu-advanced-panels.tsx` by chunk 3 of
 * docs/plans/chat-header-chips.md; the mutation handlers (with rollback +
 * toast on rejection) stay owned by VoiceChip.tsx, which passes them in.
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

/** "Model" sub-panel. */
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

/** "Voice settings" sub-panel: live + HQ transcription service pickers. */
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
  onSelectTranscriptionService: (service: TranscriptionServiceOption) => void;
  /** Comparison-only — may be "fake" (dev/test service) which never appears in the option lists. */
  currentHqService: string | null;
  onSelectHqTranscriptionService: (hqService: HqTranscriptionOption) => void;
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

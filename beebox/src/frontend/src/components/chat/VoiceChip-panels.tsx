/**
 * `VoiceChip`'s "Voice settings" sub-panel — split out of VoiceChip.tsx to
 * keep that file under the 300-line cap. Moved here from
 * `SessionChip-advanced-panels.tsx` by chunk 3 of
 * docs/plans/chat-header-chips.md; the mutation handlers (with rollback +
 * toast on rejection) stay owned by VoiceChip.tsx, which passes them in.
 * (The Model sub-panel that used to live here moved to `ChatMenu` — see
 * `SessionChip-model-panel.tsx` — in the chip polish round, since Model isn't
 * an I/O concern.)
 */

import { MenuItem, MenuDivider } from "../ui/dropdown-menu-item";
import type { HqTranscriptionService, TranscriptionService } from "@shared/transcription-services.js";
import type { TtsBackend } from "@shared/tts-backends.js";

// The vocabulary comes from `shared/`, not a copy: these unions used to be
// hand-written here and drifted from the engine's the moment a service was
// added. `fake` is a test backend and never appears in the picker.
export type TranscriptionServiceOption = Exclude<TranscriptionService, "fake">;
export type HqTranscriptionOption = HqTranscriptionService;
export type TtsBackendOption = TtsBackend;

const TRANSCRIPTION_OPTIONS: ReadonlyArray<{
  label: string;
  service: TranscriptionServiceOption;
}> = [
  { label: "Voxtral (Mistral)", service: "voxtral" },
  { label: "Deepgram", service: "deepgram" },
  { label: "Whisper (live, OpenAI)", service: "openai-realtime" },
];

const HQ_TRANSCRIPTION_OPTIONS: ReadonlyArray<{
  label: string;
  service: HqTranscriptionOption;
}> = [
  { label: "Whisper (OpenAI)", service: "whisper" },
  { label: "Whisper LLM", service: "whisper-llm" },
  { label: "Whisper LLM mini", service: "whisper-llm-mini" },
  { label: "Voxtral (Mistral)", service: "voxtral" },
  { label: "Voxtral + diarization (labels who's speaking)", service: "voxtral-diarized" },
  { label: "MAI (Microsoft, needs an OpenRouter key)", service: "mai" },
  { label: "MAI + diarization (labels who's speaking)", service: "mai-diarized" },
];

/**
 * The speaking-voice backends. `note` is shown under the label when the
 * backend changes what the boxholder's style instructions can do — a control
 * may only display what is actually true (principle 13), and "your personality
 * card's tone setting does nothing here" is exactly the kind of truth that is
 * otherwise discovered by ear.
 */
const TTS_BACKEND_OPTIONS: ReadonlyArray<{
  label: string;
  backend: TtsBackendOption;
  note?: string;
}> = [
  { label: "OpenAI (gpt-4o-mini-tts)", backend: "openai" },
  { label: "Gemini (via OpenRouter)", backend: "gemini", note: "preview model; needs an OpenRouter key. Its voices differ, so a personality-card voice is replaced." },
];

function optionLabel(options: ReadonlyArray<{ label: string; service: string }>, service: string | null): string {
  if (service === null) return "…";
  return options.find((o) => o.service === service)?.label ?? service;
}

/** Display label for the current live-transcription service — the option's
 * label, or the raw service id for values outside the picker (e.g. "fake"),
 * or "…" while the config query hasn't resolved. For the root-panel summary
 * line under "Voice settings". */
export function transcriptionServiceLabel(service: string | null): string {
  return optionLabel(TRANSCRIPTION_OPTIONS, service);
}

/** HQ counterpart of `transcriptionServiceLabel`. */
export function hqTranscriptionServiceLabel(service: string | null): string {
  return optionLabel(HQ_TRANSCRIPTION_OPTIONS, service);
}

/** Speaking-voice counterpart, for the root-panel summary line. */
export function ttsBackendLabel(backend: string | null): string {
  if (backend === null) return "…";
  return TTS_BACKEND_OPTIONS.find((o) => o.backend === backend)?.label ?? backend;
}

/** "Voice settings" sub-panel: live + HQ transcription service pickers. */
export function VoicePanel({
  onBack,
  currentService,
  onSelectTranscriptionService,
  currentHqService,
  onSelectHqTranscriptionService,
  currentTtsBackend,
  onSelectTtsBackend,
}: {
  onBack: () => void;
  /** Comparison-only — may be "fake" (dev/test service) which never appears in the option lists. */
  currentService: string | null;
  onSelectTranscriptionService: (service: TranscriptionServiceOption) => void;
  /** Comparison-only — may be "fake" (dev/test service) which never appears in the option lists. */
  currentHqService: string | null;
  onSelectHqTranscriptionService: (hqService: HqTranscriptionOption) => void;
  currentTtsBackend: string | null;
  onSelectTtsBackend: (backend: TtsBackendOption) => void;
}) {
  return (
    <>
      <MenuItem id="bbx-voice-settings-back" onClick={onBack} keepOpen>
        <span className="text-warm-500">‹ Voice settings</span>
      </MenuItem>
      <MenuDivider />
      <div className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-warm-500">While you speak</div>
      {TRANSCRIPTION_OPTIONS.map((opt) => (
        <MenuItem key={opt.service} id={`bbx-voice-live-${opt.service}`} onClick={() => onSelectTranscriptionService(opt.service)} keepOpen>
          {currentService === opt.service ? "✓ " : "  "}{opt.label}
        </MenuItem>
      ))}
      <MenuDivider />
      <div className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-warm-500">Final transcript (after recording)</div>
      {HQ_TRANSCRIPTION_OPTIONS.map((opt) => (
        <MenuItem key={opt.service} id={`bbx-voice-hq-${opt.service}`} onClick={() => onSelectHqTranscriptionService(opt.service)} keepOpen>
          {currentHqService === opt.service ? "✓ " : "  "}{opt.label}
        </MenuItem>
      ))}
          <MenuDivider />
      <div className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-warm-500">When the box speaks</div>
      {TTS_BACKEND_OPTIONS.map((opt) => (
        <MenuItem key={opt.backend} id={`bbx-voice-tts-${opt.backend}`} onClick={() => onSelectTtsBackend(opt.backend)} keepOpen>
          <span>
            {currentTtsBackend === opt.backend ? "✓ " : "  "}{opt.label}
            {opt.note !== undefined && <span className="block pl-4 text-xs text-warm-500">{opt.note}</span>}
          </span>
        </MenuItem>
      ))}
</>
  );
}

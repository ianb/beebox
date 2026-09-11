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
import type { RouterOutput } from "../../lib/trpc";
import type { HqTranscriptionService, TranscriptionService } from "@shared/transcription-services.js";
import type { TtsBackend } from "@shared/tts-backends.js";

/** `voice.capabilities`' shape — `undefined` while loading or forbidden (a
 * non-owner viewer), in which case every option renders as usable. */
export type ServiceCapabilities = RouterOutput["voice"]["capabilities"];
type ServiceCapability = ServiceCapabilities["hq"][HqTranscriptionService];

/** `needs` joined for display — "openai-thinking or openrouter". */
function formatSecretNeeds(needs: readonly string[]): string {
  return needs.join(" or ");
}

/**
 * The reason line for an unusable option, or null when it's usable (or the
 * capability is unknown — loading/forbidden queries never block a picker).
 * Pure so it's doctestable without rendering: `test/frontend/voice-chip-capability-reason.doctest.md`.
 */
export function capabilityReason(state: ServiceCapability | undefined): string | null {
  if (state === undefined || state.usable) return null;
  return `needs the ${formatSecretNeeds(state.needs)} secret — Admin → Secrets`;
}

/** The secondary line under a disabled option's label — mirrors the shape
 * `TTS_BACKEND_OPTIONS`' `note` already used, reused here rather than
 * inventing a second rendering. */
function CapabilityNote({ needs }: { needs: readonly string[] }) {
  return (
    <span className="block pl-4 text-xs text-warm-500">
      needs the <code className="font-mono">{formatSecretNeeds(needs)}</code> secret — Admin → Secrets
    </span>
  );
}

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
  { label: "MAI (Microsoft)", service: "mai" },
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
  { label: "Gemini (via OpenRouter)", backend: "gemini", note: "preview model. Its voices differ, so a personality-card voice is replaced." },
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

/** "Voice settings" sub-panel: live + HQ transcription service pickers. */
export function VoicePanel({
  onBack,
  currentService,
  onSelectTranscriptionService,
  currentHqService,
  onSelectHqTranscriptionService,
  currentTtsBackend,
  onSelectTtsBackend,
  capabilities,
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
  /** Undefined while loading or forbidden (non-owner viewer) — every option
   * renders as usable rather than blocking the picker on this query. */
  capabilities?: ServiceCapabilities;
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
      {HQ_TRANSCRIPTION_OPTIONS.map((opt) => {
        const isSelected = currentHqService === opt.service;
        const cap = capabilities?.hq[opt.service];
        const reason = capabilityReason(cap);
        return (
          <MenuItem
            key={opt.service}
            id={`bbx-voice-hq-${opt.service}`}
            onClick={() => onSelectHqTranscriptionService(opt.service)}
            keepOpen
            disabled={reason !== null && !isSelected}
          >
            <span>
              {isSelected ? "✓ " : "  "}{opt.label}
              {reason !== null && cap !== undefined && <CapabilityNote needs={cap.needs} />}
            </span>
          </MenuItem>
        );
      })}
          <MenuDivider />
      <div className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-warm-500">When the box speaks</div>
      {TTS_BACKEND_OPTIONS.map((opt) => {
        const isSelected = currentTtsBackend === opt.backend;
        const cap = capabilities?.tts[opt.backend];
        const reason = capabilityReason(cap);
        return (
          <MenuItem
            key={opt.backend}
            id={`bbx-voice-tts-${opt.backend}`}
            onClick={() => onSelectTtsBackend(opt.backend)}
            keepOpen
            disabled={reason !== null && !isSelected}
          >
            <span>
              {isSelected ? "✓ " : "  "}{opt.label}
              {opt.note !== undefined && <span className="block pl-4 text-xs text-warm-500">{opt.note}</span>}
              {reason !== null && cap !== undefined && <CapabilityNote needs={cap.needs} />}
            </span>
          </MenuItem>
        );
      })}
</>
  );
}

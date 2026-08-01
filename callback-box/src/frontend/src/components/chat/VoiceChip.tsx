/**
 * The chat header's voice chip: a Dropdown-triggered chip whose face shows
 * mute/narration/transcribing state, and whose menu holds every voice
 * control (Mute, Narration mode, Model, Voice settings) — moved here from
 * `ChatMenu`/`MuteButton`/`NarrationStatusBadge` by chunk 3 of
 * docs/plans/chat-header-chips.md.
 *
 * `VoiceChipFace` is exported separately so it can be rendered in a doctest
 * (test/frontend/voice-chip-face.doctest.md) without the Dropdown/router
 * context the full chip needs.
 */

import { useState, type ReactNode } from "react";
import { Dropdown, MenuItem, MenuDivider } from "../ui/Dropdown";
import { trpc } from "../../lib/trpc";
import { toastError } from "../ui/toast-store";
import { MODEL_OPTIONS } from "./InteractiveChat-helpers";
import { voiceChipLabel } from "./voice-chip-label";
import {
  ModelPanel, VoicePanel,
  type TranscriptionServiceOption, type HqTranscriptionOption,
} from "./VoiceChip-panels";

// Single-panel submenu pattern (see ChatMenu.tsx): the dropdown swaps which
// set of rows it renders rather than spawning a flyout. Resets to "root"
// when the dropdown closes.
type VoiceChipPanel = "root" | "model" | "voice";

/**
 * Speaker icon reflecting mute state — the same shapes `MuteButton` used
 * (now retired).
 */
function SpeakerIcon({ muted }: { muted: boolean }) {
  if (muted) {
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5 6 9H3v6h3l5 4V5zM17 9l4 6m0-6-4 6" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5 6 9H3v6h3l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M18.36 5.64a9 9 0 0 1 0 12.72" />
    </svg>
  );
}

export interface VoiceChipFaceState {
  muted: boolean;
  narrationEnabled: boolean;
  hqInFlight: boolean;
}

/**
 * Presentational chip face: speaker icon (slashed when muted), a corner dot
 * when narration is on, and a transient "transcribing…" label while HQ
 * transcription is in flight — the readable text `NarrationStatusBadge` used
 * to show, preserved here. Renderable standalone (no Dropdown/router
 * context), so the doctest exercises it directly.
 */
export function VoiceChipFace({ muted, narrationEnabled, hqInFlight }: VoiceChipFaceState) {
  return (
    <span
      className="relative inline-flex items-center gap-1"
      data-voice-muted={muted}
      data-voice-narration={narrationEnabled}
    >
      <span className="relative inline-flex">
        <SpeakerIcon muted={muted} />
        {narrationEnabled ? (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-white"
          />
        ) : null}
      </span>
      {hqInFlight ? <span className="text-xs opacity-80">transcribing…</span> : null}
    </span>
  );
}

interface VoiceChipBodyProps {
  panel: VoiceChipPanel;
  muted: boolean;
  onToggleMute: () => void;
  narrationEnabled: boolean;
  onToggleNarration: () => void;
  currentModelLabel: string;
  onOpenModel: () => void;
  onOpenVoice: () => void;
  onBackToRoot: () => void;
  selectedModel: string | null;
  onSelectModel: (model: string | null) => void;
  currentService: string | null;
  onSelectTranscriptionService: (service: TranscriptionServiceOption) => void;
  currentHqService: string | null;
  onSelectHqTranscriptionService: (hqService: HqTranscriptionOption) => void;
}

/**
 * Exhaustive panel dispatch — a `switch` with no `default:` (the frontend
 * `.tsx` rule bans `default:` cases outright; TypeScript's
 * switch-exhaustiveness check still catches an unhandled new
 * `VoiceChipPanel` member at compile time without one).
 */
function VoiceChipBody(props: VoiceChipBodyProps): ReactNode {
  const {
    panel, muted, onToggleMute, narrationEnabled, onToggleNarration, currentModelLabel, onOpenModel, onOpenVoice,
    onBackToRoot, selectedModel, onSelectModel, currentService, onSelectTranscriptionService, currentHqService,
    onSelectHqTranscriptionService,
  } = props;
  switch (panel) {
    case "root":
      return (
        <>
          <MenuItem onClick={onToggleMute}>{muted ? "✓ " : "  "}Mute</MenuItem>
          <MenuItem onClick={onToggleNarration}>{narrationEnabled ? "✓ " : "  "}Narration mode</MenuItem>
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
        </>
      );
    case "model":
      return <ModelPanel onBack={onBackToRoot} selectedModel={selectedModel} onSelectModel={onSelectModel} />;
    case "voice":
      return (
        <VoicePanel
          onBack={onBackToRoot}
          currentService={currentService}
          onSelectTranscriptionService={onSelectTranscriptionService}
          currentHqService={currentHqService}
          onSelectHqTranscriptionService={onSelectHqTranscriptionService}
        />
      );
  }
}

/**
 * The chat header's voice dropdown menu.
 */
export function VoiceChip({
  muted,
  onToggleMute,
  narrationEnabled,
  onToggleNarration,
  hqInFlight,
  selectedModel,
  onSelectModel,
}: {
  muted: boolean;
  onToggleMute: () => void;
  narrationEnabled: boolean;
  onToggleNarration: () => void;
  hqInFlight: boolean;
  selectedModel: string | null;
  onSelectModel: (model: string | null) => void;
}) {
  const utils = trpc.useUtils();
  const transcriptionConfigQuery = trpc.transcription.config.useQuery();
  // Neither mutation is applied optimistically — `currentService`/
  // `currentHqService` below come straight from the query, so a rejection
  // needs no local rollback, only a surfaced failure (the query stays as-is
  // on error, since it's never invalidated).
  const setTranscriptionService = trpc.transcription.setService.useMutation({
    onSuccess: () => { void utils.transcription.config.invalidate(); },
    onError: (e) => { toastError("Failed to switch the live transcription service", { cause: e }); },
  });
  const setHqTranscriptionService = trpc.transcription.setHqService.useMutation({
    onSuccess: () => { void utils.transcription.config.invalidate(); },
    onError: (e) => { toastError("Failed to switch the HQ transcription service", { cause: e }); },
  });
  const currentService = transcriptionConfigQuery.data?.service ?? null;
  const currentHqService = transcriptionConfigQuery.data?.hqService ?? null;

  const onSelectTranscriptionService = (service: TranscriptionServiceOption) => {
    if (currentService === service) return;
    setTranscriptionService.mutate({ service });
  };

  const onSelectHqTranscriptionService = (hqService: HqTranscriptionOption) => {
    if (currentHqService === hqService) return;
    setHqTranscriptionService.mutate({ hqService });
  };

  const [panel, setPanel] = useState<VoiceChipPanel>("root");
  const currentModelLabel = MODEL_OPTIONS.find((o) => o.model === selectedModel)?.label ?? "Default";
  const label = voiceChipLabel({ muted, narrationEnabled, hqInFlight });

  return (
    <Dropdown
      align="right"
      width="w-56"
      onClose={() => setPanel("root")}
      trigger={({ toggle, ariaProps }) => (
        <button
          type="button"
          onClick={toggle}
          className="min-h-[40px] px-2 flex items-center justify-center rounded hover:bg-white/20 text-white/80 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          title={label}
          aria-label={label}
          {...ariaProps}
        >
          <VoiceChipFace muted={muted} narrationEnabled={narrationEnabled} hqInFlight={hqInFlight} />
        </button>
      )}
    >
      <VoiceChipBody
        panel={panel}
        muted={muted}
        onToggleMute={onToggleMute}
        narrationEnabled={narrationEnabled}
        onToggleNarration={onToggleNarration}
        currentModelLabel={currentModelLabel}
        onOpenModel={() => setPanel("model")}
        onOpenVoice={() => setPanel("voice")}
        onBackToRoot={() => setPanel("root")}
        selectedModel={selectedModel}
        onSelectModel={onSelectModel}
        currentService={currentService}
        onSelectTranscriptionService={onSelectTranscriptionService}
        currentHqService={currentHqService}
        onSelectHqTranscriptionService={onSelectHqTranscriptionService}
      />
    </Dropdown>
  );
}

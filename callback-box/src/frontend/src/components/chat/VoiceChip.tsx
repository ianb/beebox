/**
 * The chat header's voice chip: a Dropdown-triggered chip whose face shows
 * mute/narration/transcribing state, and whose menu holds the I/O voice
 * controls (Mute, Narration mode, Voice settings) — moved here from
 * `ChatMenu`/`MuteButton`/`NarrationStatusBadge` by chunk 3 of
 * docs/plans/chat-header-chips.md. Model selection moved out to `ChatMenu`
 * in the chip polish round (docs/plans/chat-header-chips.md follow-up) —
 * this chip is purely I/O now.
 *
 * `VoiceChipFace` is exported separately so it can be rendered in a doctest
 * (test/frontend/voice-chip-face.doctest.md) without the Dropdown/router
 * context the full chip needs.
 */

import { useState, type ReactNode } from "react";
import { Dropdown } from "../ui/Dropdown";
import { MenuItem, MenuDivider } from "../ui/dropdown-menu-item";
import { trpc } from "../../lib/trpc";
import { toastError } from "../ui/toast-store";
import { voiceChipLabel } from "./voice-chip-label";
import { VoicePanel, type TranscriptionServiceOption, type HqTranscriptionOption } from "./VoiceChip-panels";

// Single-panel submenu pattern (see ChatMenu.tsx): the dropdown swaps which
// set of rows it renders rather than spawning a flyout. Resets to "root"
// when the dropdown closes.
type VoiceChipPanel = "root" | "voice";

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

/** Mic icon representing narration (input) mode. */
function MicIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM19 11a7 7 0 0 1-14 0M12 19v3" />
    </svg>
  );
}

export interface VoiceChipFaceState {
  muted: boolean;
  narrationEnabled: boolean;
  hqInFlight: boolean;
}

/**
 * Presentational chip face: a split pill with two segments — a mic icon for
 * narration (input, dimmed when off) and a speaker icon for mute (output,
 * slashed when muted) — divided by a thin vertical rule, plus a transient
 * "transcribing…" label while HQ transcription is in flight (the readable
 * text `NarrationStatusBadge` used to show, preserved here). Renderable
 * standalone (no Dropdown/router context), so the doctest exercises it
 * directly. The whole pill is one tap target (wired up by the caller); the
 * two icons are not separately actionable.
 */
export function VoiceChipFace({ muted, narrationEnabled, hqInFlight }: VoiceChipFaceState) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      data-voice-muted={muted}
      data-voice-narration={narrationEnabled}
    >
      <span className={narrationEnabled ? "opacity-100" : "opacity-40"}>
        <MicIcon />
      </span>
      <span aria-hidden="true" className="w-px h-4 bg-white/20" />
      <SpeakerIcon muted={muted} />
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
  onOpenVoice: () => void;
  onBackToRoot: () => void;
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
    panel, muted, onToggleMute, narrationEnabled, onToggleNarration, onOpenVoice,
    onBackToRoot, currentService, onSelectTranscriptionService, currentHqService,
    onSelectHqTranscriptionService,
  } = props;
  switch (panel) {
    case "root":
      return (
        <>
          <MenuItem onClick={onToggleMute}>{muted ? "✓ " : "  "}Mute</MenuItem>
          <MenuItem onClick={onToggleNarration}>{narrationEnabled ? "✓ " : "  "}Narration mode</MenuItem>
          <MenuDivider />
          <MenuItem onClick={onOpenVoice} keepOpen>
            <span className="flex justify-between gap-2 w-full">
              <span>Voice settings</span>
              <span className="text-warm-500">›</span>
            </span>
          </MenuItem>
        </>
      );
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
}: {
  muted: boolean;
  onToggleMute: () => void;
  narrationEnabled: boolean;
  onToggleNarration: () => void;
  hqInFlight: boolean;
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
  const label = voiceChipLabel({ muted, narrationEnabled, hqInFlight });

  return (
    <Dropdown
      align="right"
      width="w-56"
      panelIndex={panel === "root" ? 0 : 1}
      onClose={() => setPanel("root")}
      trigger={({ toggle, ariaProps }) => (
        <button
          type="button"
          onClick={toggle}
          className="min-h-[40px] px-3 flex items-center justify-center rounded-full bg-white/10 border border-white/15 hover:bg-white/20 text-white/80 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
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
        onOpenVoice={() => setPanel("voice")}
        onBackToRoot={() => setPanel("root")}
        currentService={currentService}
        onSelectTranscriptionService={onSelectTranscriptionService}
        currentHqService={currentHqService}
        onSelectHqTranscriptionService={onSelectHqTranscriptionService}
      />
    </Dropdown>
  );
}

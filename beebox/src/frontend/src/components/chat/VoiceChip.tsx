/**
 * The voice chip: a Dropdown-triggered chip whose face shows
 * mute/narration/transcribing state, and whose menu holds the I/O voice
 * controls (Mute, Narration mode, Voice settings) — moved here from
 * `ChatMenu`/`MuteButton`/`NarrationStatusBadge` by chunk 3 of
 * docs/plans/chat-header-chips.md. Model selection moved out to the session
 * chip in the chip polish round (docs/plans/chat-header-chips.md follow-up)
 * — this chip is purely I/O now. Since Track C2 of
 * docs/plans/top-nav-ia.md it renders in the app bar's chip slot rather than
 * a chat header row; the chip itself is unchanged.
 *
 * `VoiceChipFace` is exported separately so it can be rendered in a doctest
 * (test/frontend/voice-chip-face.doctest.md) without the Dropdown/router
 * context the full chip needs.
 */

import { memo, useState, type ReactNode } from "react";
import { Dropdown } from "../ui/Dropdown";
import { MenuItem, MenuDivider } from "../ui/dropdown-menu-item";
import { trpc } from "../../lib/trpc";
import { toastError } from "../ui/toast-store";
import { voiceChipLabel } from "./voice-chip-label";
import {
  VoicePanel, transcriptionServiceLabel, hqTranscriptionServiceLabel,
  type TranscriptionServiceOption, type HqTranscriptionOption, type TtsBackendOption,
  type ServiceCapabilities,
} from "./VoiceChip-panels";
import { useVoiceCapabilities } from "./VoiceChip-capabilities";
import { HqPreferenceRow, type HqDefaultsState } from "./HqPreferenceRow";
import { CloseButton } from "../ui/CloseButton";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { TextLink } from "../ui/TextLink";
import { clearHqFailure, useHqFailure, type HqFailure } from "../../lib/hq-failure";
import { SpeakerIcon, MicIcon, HqIcon } from "./VoiceChip-icons";

// Single-panel submenu pattern (see SessionChip.tsx): the dropdown swaps which
// set of rows it renders rather than spawning a flyout. Resets to "root"
// when the dropdown closes.
type VoiceChipPanel = "root" | "voice";

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

/**
 * A permanent HQ transcription failure (Track 6,
 * `docs/plans/secret-entry-guidance.md`): the server's own message, a link to
 * where the missing credential is fixed, and a dismiss. Rendered in the root
 * panel so opening the voice menu is enough to see it — the realtime
 * fallback means the chat otherwise looks fine.
 */
function HqFailureNotice({ failure, onDismiss }: { failure: HqFailure; onDismiss: () => void }) {
  return (
    <div role="alert" className="px-3 py-2">
      <Stack gap="xs">
        <Row gap="sm" align="start" justify="between">
          <Text size="sm" tone="danger">{failure.message}</Text>
          <CloseButton size="sm" label="Dismiss" onClick={onDismiss} />
        </Row>
        <TextLink to="/admin" tone="subtle">Admin → Secrets</TextLink>
      </Stack>
    </div>
  );
}

interface VoiceChipBodyProps {
  panel: VoiceChipPanel;
  hqFailure: HqFailure | null;
  onDismissHqFailure: () => void;
  muted: boolean;
  onToggleMute: () => void;
  narrationEnabled: boolean;
  onToggleNarration: () => void;
  hqDictationEnabled: boolean;
  onToggleHqDictation: () => void;
  hqDefaults: HqDefaultsState;
  onOpenVoice: () => void;
  onBackToRoot: () => void;
  currentService: string | null;
  onSelectTranscriptionService: (service: TranscriptionServiceOption) => void;
  currentHqService: string | null;
  onSelectHqTranscriptionService: (hqService: HqTranscriptionOption) => void;
  currentTtsBackend: string | null;
  onSelectTtsBackend: (backend: TtsBackendOption) => void;
  capabilities: ServiceCapabilities | undefined;
}

/**
 * Exhaustive panel dispatch — a `switch` with no `default:` (the frontend
 * `.tsx` rule bans `default:` cases outright; TypeScript's
 * switch-exhaustiveness check still catches an unhandled new
 * `VoiceChipPanel` member at compile time without one).
 */
function VoiceChipBody(props: VoiceChipBodyProps): ReactNode {
  const {
    panel, muted, onToggleMute, narrationEnabled, onToggleNarration,
    hqDictationEnabled, onToggleHqDictation, hqDefaults, onOpenVoice,
    onBackToRoot, currentService, onSelectTranscriptionService, currentHqService,
    onSelectHqTranscriptionService, currentTtsBackend, onSelectTtsBackend,
    hqFailure, onDismissHqFailure, capabilities,
  } = props;
  switch (panel) {
    case "root":
      return (
        <>
          {hqFailure === null ? null : (
            <>
              <HqFailureNotice failure={hqFailure} onDismiss={onDismissHqFailure} />
              <MenuDivider />
            </>
          )}
          <MenuItem id="bbx-voice-mute" onClick={onToggleMute} icon={<SpeakerIcon muted={muted} />}>
            {muted ? "✓ " : ""}Mute
          </MenuItem>
          <MenuItem
            id="bbx-voice-narration"
            onClick={onToggleNarration}
            icon={
              <span className={narrationEnabled ? undefined : "opacity-40"}>
                <MicIcon />
              </span>
            }
          >
            {narrationEnabled ? "✓ " : ""}Narration mode
          </MenuItem>
          <HqPreferenceRow
            enabled={hqDictationEnabled}
            onToggle={onToggleHqDictation}
            defaults={hqDefaults}
            icon={<HqIcon />}
          />
          <MenuDivider />
          <MenuItem id="bbx-voice-settings" onClick={onOpenVoice} keepOpen>
            <span className="flex justify-between gap-2 w-full">
              <span className="min-w-0">
                Voice settings
                <span className="block text-xs text-warm-500 truncate">
                  Live: {transcriptionServiceLabel(currentService)}
                </span>
                <span className="block text-xs text-warm-500 truncate">
                  HQ: {hqTranscriptionServiceLabel(currentHqService)}
                </span>
              </span>
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
          currentTtsBackend={currentTtsBackend}
          onSelectTtsBackend={onSelectTtsBackend}
          capabilities={capabilities}
        />
      );
  }
}

export interface VoiceChipProps {
  contextDir: string | null;
  canManageDefaults: boolean;
  muted: boolean;
  onToggleMute: () => void;
  narrationEnabled: boolean;
  onToggleNarration: () => void;
  hqDictationEnabled: boolean;
  onToggleHqDictation: () => void;
  hqInFlight: boolean;
}

/**
 * The voice dropdown menu, now portaled into the app bar's chip slot
 * (`ChatBarChrome`, Track C2 of docs/plans/top-nav-ia.md) rather than
 * rendered in a chat header row. `React.memo` because the publishing tree
 * re-renders on every streaming token and the bar must not — its five props
 * are primitives and `useCallback`s, so the memo holds.
 */
export const VoiceChip = memo(function VoiceChip({
  contextDir,
  canManageDefaults,
  muted,
  onToggleMute,
  narrationEnabled,
  onToggleNarration,
  hqDictationEnabled,
  onToggleHqDictation,
  hqInFlight,
}: VoiceChipProps) {
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
    onSuccess: (result) => {
      void utils.transcription.config.invalidate();
      if (result.warning !== null) toastError(result.warning);
    },
    onError: (e) => { toastError("Failed to switch the HQ transcription service", { cause: e }); },
  });
  const ttsConfigQuery = trpc.tts.config.useQuery();
  const setTtsBackend = trpc.tts.setBackend.useMutation({
    onSuccess: (result) => {
      void utils.tts.config.invalidate();
      if (result.warning !== null) toastError(result.warning);
    },
    onError: (e) => { toastError("Failed to switch the speaking-voice backend", { cause: e }); },
  });
  const capabilities = useVoiceCapabilities(canManageDefaults);
  const currentService = transcriptionConfigQuery.data?.service ?? null;
  const currentHqService = transcriptionConfigQuery.data?.hqService ?? null;
  const currentTtsBackend = ttsConfigQuery.data?.backend ?? null;
  const hqDefaultsQuery = trpc.landmarks.hqPreferences.useQuery(
    { dir: contextDir },
    { enabled: canManageDefaults },
  );
  const setLandmarkHq = trpc.landmarks.setHqPreference.useMutation({
    onSuccess: (result) => {
      void utils.landmarks.hqPreferences.invalidate();
      if (result.commitWarning !== null) toastError(result.commitWarning);
    },
    onError: (error) => { toastError("Failed to save the landmark HQ setting", { cause: error }); },
  });
  const setBoxHq = trpc.admin.updateBoxConfig.useMutation({
    onSuccess: (result) => {
      void utils.landmarks.hqPreferences.invalidate();
      if (result.commitWarning !== null) toastError(result.commitWarning);
    },
    onError: (error) => { toastError("Failed to save the box HQ setting", { cause: error }); },
  });
  const hqDefaults: HqDefaultsState = {
    canManage: canManageDefaults,
    hasLandmark: hqDefaultsQuery.data?.hasLandmark ?? false,
    landmark: hqDefaultsQuery.data?.landmark ?? "inherit",
    box: hqDefaultsQuery.data?.box ?? "off",
    pending: hqDefaultsQuery.isLoading || setLandmarkHq.isPending || setBoxHq.isPending,
    onLandmarkChange: (value) => {
      if (contextDir !== null) setLandmarkHq.mutate({ dir: contextDir, value });
    },
    onBoxChange: (value) => { setBoxHq.mutate({ hqDictation: value }); },
  };

  const onSelectTranscriptionService = (service: TranscriptionServiceOption) => {
    if (currentService === service) return;
    setTranscriptionService.mutate({ service });
  };

  const onSelectHqTranscriptionService = (hqService: HqTranscriptionOption) => {
    if (currentHqService === hqService) return;
    setHqTranscriptionService.mutate({ hqService });
  };

  const onSelectTtsBackend = (backend: TtsBackendOption) => {
    if (currentTtsBackend === backend) return;
    setTtsBackend.mutate({ backend });
  };

  const [panel, setPanel] = useState<VoiceChipPanel>("root");
  const label = voiceChipLabel({ muted, narrationEnabled, hqInFlight });
  const hqFailure = useHqFailure();

  return (
    <Dropdown
      align="right"
      // Slightly wider than the menu default so the scope controls remain
      // compact without making the menu dominate a narrow viewport.
      width="w-[min(18rem,calc(100vw-1rem))]"
      panelIndex={panel === "root" ? 0 : 1}
      onClose={() => setPanel("root")}
      trigger={({ toggle, ariaProps }) => (
        <button
          type="button"
          id="bbx-nav-voice"
          data-bbx-reveal
          data-bbx-does="opens the voice menu — mute, narration mode, transcription services"
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
        hqDictationEnabled={hqDictationEnabled}
        onToggleHqDictation={onToggleHqDictation}
        hqDefaults={hqDefaults}
        onOpenVoice={() => { setPanel("voice"); capabilities.refetch(); }}
        onBackToRoot={() => setPanel("root")}
        currentService={currentService}
        onSelectTranscriptionService={onSelectTranscriptionService}
        currentHqService={currentHqService}
        onSelectHqTranscriptionService={onSelectHqTranscriptionService}
        currentTtsBackend={currentTtsBackend}
        onSelectTtsBackend={onSelectTtsBackend}
        hqFailure={hqFailure}
        onDismissHqFailure={clearHqFailure}
        capabilities={capabilities.data}
      />
    </Dropdown>
  );
});

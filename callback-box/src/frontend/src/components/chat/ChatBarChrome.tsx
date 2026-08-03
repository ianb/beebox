/**
 * The chat's contribution to the unified app bar (docs/plans/top-nav-ia.md
 * Track C2), replacing the old chat header row.
 *
 * Three publications, no rendered output of its own:
 *  - the **place** (the session's context dir + its landmark/basename label),
 *    which the pill's left half names;
 *  - the session and voice **chips**, portaled into the bar's chip slots;
 *  - the full **here menu** body, portaled into the pill's here dropdown
 *    while it's open (and claimed, so the bar renders its reduced menu until
 *    this component mounts).
 *
 * **This component re-renders on every streaming token** — it hangs off the
 * `InteractiveChat` root, which reads the chat machine's snapshot. A portal
 * relocates DOM but does NOT isolate renders, so the bar would tick per token
 * unless every portaled child is `React.memo`'d with referentially stable
 * props. That is the same discipline `CompanionViewPanel` follows
 * (`components/chat/CLAUDE.md`), and it's why the props below are all either
 * primitives or `useCallback`s from the chat hooks — an inline arrow or a
 * fresh object literal here silently re-enables per-token bar renders.
 *
 * The place publication rides an effect with primitive deps, so it does not
 * happen per render at all.
 */

import { useCallback, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { trpc } from "../../lib/trpc";
import { PortaledMenuScope } from "../ui/Dropdown";
import { useAppBarHereMenuClaim, useAppBarPlace, useAppBarSlots } from "../app-bar-chrome";
import { contextChipLabel } from "./context-chip-label";
import { ContextMenuBody } from "./ContextMenuBody";
import { SessionChip } from "./SessionChip";
import { VoiceChip } from "./VoiceChip";
import type { SessionEntry } from "../../api";
import type { OnZoomView } from "./ChatMessages";

export interface ChatBarChromeProps {
  /** The session's bound directory: `""` for box root, null for no context. */
  contextDir: string | null;
  boxSlug: string | undefined;
  /** The session's display name (`chat.bootstrap`'s `label`). */
  sessionLabel: string | null;
  messages: SessionEntry[];
  onZoomView: OnZoomView;
  muted: boolean;
  onToggleMute: () => void;
  narrationEnabled: boolean;
  onToggleNarration: () => void;
  hqInFlight: boolean;
  onNewSession: () => void;
  selectedModel: string | null;
  onSelectModel: (model: string | null) => void;
  onStopProcess: () => void;
  onRestartProcess: () => void;
  onCompactSession: () => void;
  sessionId: string | null;
  running: boolean;
  busy: boolean;
  debugView: boolean;
  setDebugView: Dispatch<SetStateAction<boolean>>;
  showDebugLog: boolean;
  setShowDebugLog: Dispatch<SetStateAction<boolean>>;
}

export function ChatBarChrome(props: ChatBarChromeProps) {
  const {
    contextDir, boxSlug, sessionLabel, messages, onZoomView,
    muted, onToggleMute, narrationEnabled, onToggleNarration, hqInFlight,
    onNewSession, selectedModel, onSelectModel, onStopProcess, onRestartProcess, onCompactSession,
    sessionId, running, busy, debugView, setDebugView, showDebugLog, setShowDebugLog,
  } = props;

  // The same landmark lookup the retired ContextChip made — react-query
  // dedupes it with the pill's own `forDir` call for the same dir.
  const { data: landmarkData } = trpc.landmarks.forDir.useQuery(
    { dir: contextDir ?? "" },
    { enabled: contextDir !== null },
  );
  const landmarkLabel = landmarkData?.landmark?.label ?? null;
  // `contextChipLabel`'s chain (landmark → dir basename → "Box root"), except
  // that a chat with no context at all is a "Chat", not "Files" — the pill
  // names a place, and the place is the chat itself.
  const label = contextDir === null ? "Chat" : contextChipLabel({ landmarkLabel, dir: contextDir });
  useAppBarPlace({ dir: contextDir, label });
  useAppBarHereMenuClaim(true);

  const { chipSlots, hereSlot } = useAppBarSlots();

  // Stable across a streamed turn: `setDebugView`/`setShowDebugLog` are React
  // state setters, so these two callbacks never change identity.
  const onToggleDebugView = useCallback(() => setDebugView((v) => !v), [setDebugView]);
  const onToggleDebugLog = useCallback(() => setShowDebugLog((v) => !v), [setShowDebugLog]);

  const chips = (
    <>
      <SessionChip
        label={sessionLabel}
        onNewSession={onNewSession}
        selectedModel={selectedModel}
        onSelectModel={onSelectModel}
        onStopProcess={onStopProcess}
        onRestartProcess={onRestartProcess}
        onCompactSession={onCompactSession}
        sessionId={sessionId}
        running={running}
        busy={busy}
        debugView={debugView}
        onToggleDebugView={onToggleDebugView}
        showDebugLog={showDebugLog}
        onToggleDebugLog={onToggleDebugLog}
      />
      <VoiceChip
        muted={muted}
        onToggleMute={onToggleMute}
        narrationEnabled={narrationEnabled}
        onToggleNarration={onToggleNarration}
        hqInFlight={hqInFlight}
      />
    </>
  );

  // No slots at all under `?embed=1` — AppLayout renders no bar there, so
  // there is nothing to portal into and this renders nothing.
  return (
    <>
      {chipSlots.map((element, i) => createPortal(chips, element, `chip-slot-${i}`))}
      {hereSlot === null ? null : createPortal(
        <PortaledMenuScope close={hereSlot.close}>
          <ContextMenuBody
            dir={contextDir}
            boxSlug={boxSlug ?? ""}
            messages={messages}
            onZoomView={onZoomView}
          />
        </PortaledMenuScope>,
        hereSlot.element,
      )}
    </>
  );
}

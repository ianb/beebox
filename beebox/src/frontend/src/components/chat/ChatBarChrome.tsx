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

import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { trpc } from "../../lib/trpc";
import { PortaledMenuScope } from "../ui/Dropdown";
import { useAppBarHereMenuClaim, useAppBarPlace, useAppBarRecentFilesClaim, useAppBarSlots } from "../app-bar-chrome";
import { contextChipLabel } from "./context-chip-label";
import { rememberLastChat } from "../../lib/last-chat";
import { ContextMenuBody, RecentFilesMenuBody } from "./ContextMenuBody";
import { SessionChip } from "./SessionChip";
import { VoiceChip } from "./VoiceChip";
import type { SessionEntry } from "../../api";
import type { OnZoomView } from "./ChatMessages";
import type { ChatAgentEngine } from "@shared/chat-models.js";

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
  hqDictationEnabled: boolean;
  onToggleHqDictation: () => void;
  hqInFlight: boolean;
  onNewSession: () => void;
  selectedModel: string | null;
  modelInForce: string | null;
  boxDefault: string | null;
  canPin: boolean;
  canChooseEngine: boolean;
  enabledEngines: ChatAgentEngine[];
  boxEngine: ChatAgentEngine | null;
  onChooseStart: (choice: { engine: ChatAgentEngine; model: string }) => void;
  onPinModel: (model: string | null) => void;
  onOpenModelPanel: () => void;
  agentEngine: ChatAgentEngine | null;
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
    muted, onToggleMute, narrationEnabled, onToggleNarration,
    hqDictationEnabled, onToggleHqDictation, hqInFlight,
    onNewSession, selectedModel, modelInForce, boxDefault, canPin, canChooseEngine, enabledEngines,
    boxEngine, onChooseStart, onPinModel, onOpenModelPanel,
    agentEngine, onSelectModel, onStopProcess, onRestartProcess, onCompactSession,
    sessionId, running, busy, debugView, setDebugView, showDebugLog, setShowDebugLog,
  } = props;

  // The same landmark lookup the retired ContextChip made — react-query
  // dedupes it with the pill's own `identity` call for the same dir. Only
  // the label is needed here, so `identity` (not `forDir`'s full resolved
  // link list) is the right query — `docs/implemented-plans/card-prominence.md`, "Split
  // identity from resolution".
  const { data: landmarkData } = trpc.landmarks.identity.useQuery(
    { dir: contextDir ?? "" },
    { enabled: contextDir !== null },
  );
  const landmarkLabel = landmarkData?.identity?.label ?? null;
  // `contextChipLabel`'s chain (landmark → dir basename → "Box root"), except
  // that a chat with no context at all is a "Chat", not "Files" — the pill
  // names a place, and the place is the chat itself.
  const label = contextDir === null ? "Chat" : contextChipLabel({ landmarkLabel, dir: contextDir });
  useAppBarPlace({ dir: contextDir, label });
  // Leave a way back. Every other page reads this to decide whether to offer
  // the bar's return chip — the chat itself is the only thing that knows which
  // session the user is actually in. Primitive deps, so a streamed turn does
  // not touch storage; `rememberLastChat` is a no-op for an unchanged value
  // anyway (see `lib/last-chat.ts`).
  useEffect(() => {
    if (boxSlug === undefined || sessionId === null) return;
    rememberLastChat(boxSlug, { sessionId, label: sessionLabel });
  }, [boxSlug, sessionId, sessionLabel]);
  useAppBarHereMenuClaim(true);
  // The switch menu's "Recent files ›" row — the session's files, reachable
  // from the box-title menu even when the chat has no landmark (and so no
  // here half at all).
  useAppBarRecentFilesClaim(true);

  const { chipSlot, hereSlot, recentSlot } = useAppBarSlots();

  // Stable across a streamed turn: `setDebugView`/`setShowDebugLog` are React
  // state setters, so these two callbacks never change identity.
  const onToggleDebugView = useCallback(() => setDebugView((v) => !v), [setDebugView]);
  const onToggleDebugLog = useCallback(() => setShowDebugLog((v) => !v), [setShowDebugLog]);

  const chips = (
    <>
      <SessionChip
        label={sessionLabel}
        contextDir={contextDir}
        onNewSession={onNewSession}
        selectedModel={selectedModel}
        modelInForce={modelInForce}
        boxDefault={boxDefault}
        canPin={canPin}
        canChooseEngine={canChooseEngine}
        enabledEngines={enabledEngines}
        boxEngine={boxEngine}
        onChooseStart={onChooseStart}
        onPinModel={onPinModel}
        onOpenModelPanel={onOpenModelPanel}
        agentEngine={agentEngine}
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
        contextDir={contextDir}
        canManageDefaults={canPin}
        muted={muted}
        onToggleMute={onToggleMute}
        narrationEnabled={narrationEnabled}
        onToggleNarration={onToggleNarration}
        hqDictationEnabled={hqDictationEnabled}
        onToggleHqDictation={onToggleHqDictation}
        hqInFlight={hqInFlight}
      />
    </>
  );

  // Native composer mode keeps the app chrome; portal only when a slot exists.
  return (
    <>
      {chipSlot === null ? null : createPortal(chips, chipSlot)}
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
      {recentSlot === null ? null : createPortal(
        <PortaledMenuScope close={recentSlot.close}>
          <RecentFilesMenuBody messages={messages} onZoomView={onZoomView} />
        </PortaledMenuScope>,
        recentSlot.element,
      )}
    </>
  );
}

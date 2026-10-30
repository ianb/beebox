/**
 * The app bar's session chip — chat fiddling, named by its object
 * (docs/implemented-plans/top-nav-ia.md Track C2). Reshaped from the chat header's `⋯`
 * ChatMenu: same menu machinery (New session, Model ›, Advanced ›, the
 * panel-swap idiom).
 *
 * Sliders plus a "Chat" label identify chat properties even when the
 * conversation title is hidden. Below `sm:` only the sliders remain, and the
 * `aria-label` names the chip in full at every width. The model dial compares against the box
 * default; its attached star marks a different harness.
 *
 * "Recent chats ›" lives here, as it did on the old `⋯` menu: the pill's
 * switch menu moves between landmarks and resumes each one's newest chat, so
 * it can't reach a sibling session in the landmark you're already in. Finding
 * *a session* is a chat concern; finding *a place* is the pill's.
 *
 * Face, following the bar's one-flexible-member rule: "Chat" and caret always,
 * with the model/harness indicator alongside and the properties glyph from sm:;
 * the session label (truncated) from `sm:` up — the chip is the third thing to
 * give way as the viewport narrows, after the box prefix and the folder half's
 * label. Same composition as the pill's here-half, which is the point.
 *
 * `React.memo` is load-bearing, not decoration: this chip is portaled into
 * the bar from the chat's tree, which re-renders on every streaming token
 * (`components/chat/AGENTS.md`). Every prop must stay referentially stable
 * across a streamed turn or the bar ticks per token.
 */

import { memo, useState, type ReactNode } from "react";
import { Dropdown } from "../../../ui/Dropdown";
import { SessionChipFace } from "../../../app-bar-faces/SessionChipFace";
import { MenuItem, MenuDivider } from "../../../ui/dropdown-menu-item";
import { AdvancedPanel } from "./SessionChip-advanced-panels";
import { DeleteChatDialog } from "../../../chat-delete/DeleteChatDialog";
import { useNavigate, useParams } from "@tanstack/react-router";
import { href, toSearch } from "../../../../lib/routing";
import { ModelPanel } from "./SessionChip-model-panel";
import { SessionListPanel } from "./SessionListPanel";
import { chatModelLabel, type ChatAgentEngine } from "@shared/chat-models.js";
import { useAddedModels } from "./model-availability-store";
import { modelDrift, engineDrift } from "./model-drift";
import { MarkDoneItem } from "./MarkDoneItem";

// Single-panel submenu pattern: the dropdown swaps which set of rows it
// renders rather than spawning a flyout. Better on touch and avoids
// positioning complexity. Resets to "root" when the dropdown closes.
type SessionChipPanel = "root" | "sessions" | "model" | "advanced";

/** Root panel: New session, "Recent chats ›", "Model ›", divider, "Advanced ›". */
function RootPanel({
  onNewSession,
  onOpenSessions,
  currentModelLabel,
  modelSelectionDisabled,
  onOpenModel,
  onOpenAdvanced,
  sessionId,
}: {
  onNewSession: () => void;
  onOpenSessions: () => void;
  currentModelLabel: string;
  modelSelectionDisabled: boolean;
  onOpenModel: () => void;
  onOpenAdvanced: () => void;
  sessionId: string | null;
}) {
  return (
    <>
      <MenuItem id="bbx-session-new" onClick={onNewSession}>New chat</MenuItem>
      <MenuItem id="bbx-session-recent" onClick={onOpenSessions} keepOpen>
        <span className="flex justify-between gap-2 w-full">
          <span>Recent chats</span>
          <span className="text-warm-600">›</span>
        </span>
      </MenuItem>
      <MarkDoneItem sessionId={sessionId} />
      <MenuItem id="bbx-session-model" onClick={onOpenModel} keepOpen disabled={modelSelectionDisabled}>
        <span className="flex justify-between gap-2 w-full">
          <span>Model</span>
          <span className="text-warm-700 truncate">{currentModelLabel} ›</span>
        </span>
      </MenuItem>
      <MenuDivider />
      <MenuItem id="bbx-session-advanced" onClick={onOpenAdvanced} keepOpen>
        <span className="flex justify-between gap-2 w-full">
          <span>Advanced</span>
          <span className="text-warm-600">›</span>
        </span>
      </MenuItem>
    </>
  );
}

/** "Recent chats" sub-panel: back row + the shared `SessionListPanel` body. */
function SessionsPanel({ onBack, contextDir }: { onBack: () => void; contextDir: string | null }) {
  return (
    <>
      <MenuItem id="bbx-session-recent-back" onClick={onBack} keepOpen>
        <span className="text-warm-700">‹ Recent chats</span>
      </MenuItem>
      <MenuDivider />
      <SessionListPanel contextDir={contextDir} />
    </>
  );
}

interface SessionChipBodyProps {
  panel: SessionChipPanel;
  onNewSession: () => void;
  contextDir: string | null;
  onOpenSessions: () => void;
  currentModelLabel: string;
  modelSelectionDisabled: boolean;
  onOpenModel: () => void;
  selectedModel: string | null;
  boxDefault: string | null;
  canPin: boolean;
  canChooseEngine: boolean;
  enabledEngines: ChatAgentEngine[];
  boxEngine: ChatAgentEngine | null;
  onChooseStart: (choice: { engine: ChatAgentEngine; model: string }) => void;
  onPinModel: (model: string | null) => void;
  agentEngine: ChatAgentEngine | null;
  onSelectModel: (model: string | null) => void;
  onOpenAdvanced: () => void;
  onBackToRoot: () => void;
  advancedProps: Omit<Parameters<typeof AdvancedPanel>[0], "onBack">;
  /** The current chat's id, for the done toggle; null before one exists. */
  sessionId: string | null;
}

/**
 * Exhaustive panel dispatch — a `switch` with no `default:` (the frontend
 * `.tsx` rule bans `default:` cases outright; TypeScript's
 * switch-exhaustiveness check still catches an unhandled new
 * `SessionChipPanel` member at compile time without one).
 */
function SessionChipBody(props: SessionChipBodyProps): ReactNode {
  const { panel, onNewSession, contextDir, onOpenSessions, currentModelLabel, modelSelectionDisabled, onOpenModel, selectedModel, boxDefault, canPin, canChooseEngine, enabledEngines, boxEngine, onChooseStart, onPinModel, agentEngine, onSelectModel, onOpenAdvanced, onBackToRoot, advancedProps, sessionId } = props;
  switch (panel) {
    case "root":
      return <RootPanel onNewSession={onNewSession} onOpenSessions={onOpenSessions} currentModelLabel={currentModelLabel} modelSelectionDisabled={modelSelectionDisabled} onOpenModel={onOpenModel} onOpenAdvanced={onOpenAdvanced} sessionId={sessionId} />;
    case "sessions":
      return <SessionsPanel onBack={onBackToRoot} contextDir={contextDir} />;
    case "model":
      return agentEngine === null || boxEngine === null ? null : (
        <ModelPanel
          onBack={onBackToRoot}
          selectedModel={selectedModel}
          boxDefault={boxDefault}
          canPin={canPin}
          canChooseEngine={canChooseEngine}
          enabledEngines={enabledEngines}
          boxEngine={boxEngine}
          onChooseStart={onChooseStart}
          onPinModel={onPinModel}
          agentEngine={agentEngine}
          onSelectModel={onSelectModel}
        />
      );
    case "advanced":
      return <AdvancedPanel onBack={onBackToRoot} {...advancedProps} />;
  }
}

export interface SessionChipProps {
  /** The session's display name (`chat.bootstrap`'s `label`), or null before one exists. */
  label: string | null;
  /** Landmark dir this chat is bound to — orders the Recent chats panel. */
  contextDir: string | null;
  onNewSession: () => void;
  selectedModel: string | null;
  /** The model actually in force — this chat's pick, or the box default it follows. */
  modelInForce: string | null;
  boxDefault: string | null;
  canPin: boolean;
  /** True until this chat's first message — after that its engine is fixed. */
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
  onToggleDebugView: () => void;
  showDebugLog: boolean;
  onToggleDebugLog: () => void;
}

export const SessionChip = memo(function SessionChip(props: SessionChipProps) {
  const {
    label,
    contextDir,
    onNewSession,
    selectedModel,
    modelInForce,
    boxDefault,
    canPin,
    canChooseEngine,
    enabledEngines,
    boxEngine,
    onChooseStart,
    onPinModel,
    onOpenModelPanel,
    agentEngine,
    onSelectModel,
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
  } = props;
  const [panel, setPanel] = useState<SessionChipPanel>("root");
  const addedModels = useAddedModels();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const navigate = useNavigate();
  const { boxSlug } = useParams({ strict: false });
  // pi has no "Default (…)" row, so a chat following the box default names
  // the default model itself.
  const currentModelLabel = agentEngine === null
    ? "Unavailable"
    : chatModelLabel(agentEngine, { model: modelInForce ?? (agentEngine === "pi" ? boxDefault : null), added: addedModels }) ?? "Unavailable";
  // `modelInForce` is null for a chat that FOLLOWS the box default — that is
  // what makes the label read "Default (Opus)" rather than naming the model —
  // so the drift comparison resolves it first. Without this the gauge was blank
  // for the most common case there is, which is most of why the old mark looked
  // unreliable. While status is still loading both are null and the comparison
  // correctly declines to answer.
  const drift = modelDrift({ model: modelInForce ?? boxDefault, boxDefault });
  const offEngine = engineDrift({ engine: agentEngine, boxEngine });
  const titled = label !== null && label !== "";
  // The marks are decoration; the meaning is in the name, so a screen reader
  // hears "below the box default" rather than a description of a dial.
  const driftPhrase = drift === null ? "" : ` — ${drift === "above" ? "above" : drift === "below" ? "below" : "at"} the box default`;
  const enginePhrase = offEngine ? `, on ${agentEngine ?? "another harness"} rather than the box's ${boxEngine ?? "own"}` : "";
  const accessibleName = `${titled ? `Chat: ${label}` : "Chat menu"} · ${currentModelLabel}${driftPhrase}${enginePhrase}`;

  return (
    <>
      <Dropdown
        align="right"
        // The Recent-chats panel renders two-line rows (label, id, timestamp,
        // landmark) that want 28rem; the other panels keep the compact menu
        // width. Dropdown's viewport clamp still bounds it on narrow screens.
        width={panel === "sessions" ? "w-[28rem]" : "w-56"}
        panelIndex={panel === "root" ? 0 : 1}
        onClose={() => setPanel("root")}
        trigger={({ toggle, ariaProps }) => (
          <SessionChipFace label={label} drift={drift} offEngine={offEngine} accessibleName={accessibleName} onClick={toggle} ariaProps={ariaProps} />
        )}
      >
        <SessionChipBody
          panel={panel}
          onNewSession={onNewSession}
          contextDir={contextDir}
          onOpenSessions={() => setPanel("sessions")}
          currentModelLabel={currentModelLabel}
          // A chat with no id yet cannot set a model of its own, but the panel
          // is also where the box default is pinned and shown — so it opens.
          modelSelectionDisabled={agentEngine === null}
          onOpenModel={() => { onOpenModelPanel(); setPanel("model"); }}
          selectedModel={selectedModel}
          boxDefault={boxDefault}
          canPin={canPin}
          canChooseEngine={canChooseEngine}
          enabledEngines={enabledEngines}
          boxEngine={boxEngine}
          onChooseStart={onChooseStart}
          onPinModel={onPinModel}
          agentEngine={agentEngine}
          onSelectModel={onSelectModel}
          onOpenAdvanced={() => setPanel("advanced")}
          onBackToRoot={() => setPanel("root")}
          sessionId={sessionId}
          advancedProps={{
            debugView,
            onToggleDebugView,
            showDebugLog,
            onToggleDebugLog,
            onCompactSession,
            busy,
            onRestartProcess,
            onStopProcess,
            running,
            sessionId,
            onDeleteConversation: () => setDeleteOpen(true),
          }}
        />
      </Dropdown>
      {sessionId === null ? null : (
        <DeleteChatDialog
          open={deleteOpen}
          sessionId={sessionId}
          label={label}
          onClose={() => setDeleteOpen(false)}
          onResult={(result) => {
            if (result.status === "deleted" || result.storage !== "present") {
              void navigate({
                to: href(`/${boxSlug}/chat`),
                search: toSearch({ session: "new" }),
              });
            }
          }}
        />
      )}
    </>
  );
});

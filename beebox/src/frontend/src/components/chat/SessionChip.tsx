/**
 * The app bar's session chip — chat fiddling, named by its object
 * (docs/plans/top-nav-ia.md Track C2). Reshaped from the chat header's `⋯`
 * ChatMenu: same menu machinery (New session, Model ›, Advanced ›, the
 * panel-swap idiom).
 *
 * Sliders plus a "Chat" label identify chat properties even when the
 * conversation title is hidden. Below `sm:` only the sliders remain: the label
 * and the glyph say the same thing, and the phone bar cannot afford both
 * (`issues/bugs/2026-09-15-mobile-app-bar-crowds-place-label.md`). The
 * `aria-label` names the chip in full at every width, so nothing is lost to a
 * screen reader when the word goes. The model dial compares against the box
 * default; its attached star marks a different harness.
 *
 * "Recent chats ›" lives here, as it did on the old `⋯` menu: the pill's
 * switch menu moves between landmarks and resumes each one's newest chat, so
 * it can't reach a sibling session in the landmark you're already in. Finding
 * *a session* is a chat concern; finding *a place* is the pill's.
 *
 * Face, following the bar's one-flexible-member rule: the properties glyph and
 * caret always, with the model/harness indicator alongside; the "Chat" label
 * and the session label (truncated) from `sm:` up — the chip is the third thing
 * to give way as the viewport narrows, after the box prefix and the folder
 * half's label. Same composition as the pill's here-half, which is the point.
 *
 * `React.memo` is load-bearing, not decoration: this chip is portaled into
 * the bar from the chat's tree, which re-renders on every streaming token
 * (`components/chat/CLAUDE.md`). Every prop must stay referentially stable
 * across a streamed turn or the bar ticks per token.
 */

import { memo, useState, type ReactNode } from "react";
import { Dropdown } from "../ui/Dropdown";
import { MenuItem, MenuDivider } from "../ui/dropdown-menu-item";
import { AdvancedPanel } from "./SessionChip-advanced-panels";
import { DeleteChatDialog } from "../chat-delete/DeleteChatDialog";
import { useNavigate, useParams } from "@tanstack/react-router";
import { href, toSearch } from "../../lib/routing";
import { ModelPanel } from "./SessionChip-model-panel";
import { SessionListPanel } from "./SessionListPanel";
import { chatModelLabel, type ChatAgentEngine } from "@shared/chat-models.js";
import { useAddedModels } from "./model-availability-store";
import { modelDrift, engineDrift } from "./model-drift";

// Single-panel submenu pattern: the dropdown swaps which set of rows it
// renders rather than spawning a flyout. Better on touch and avoids
// positioning complexity. Resets to "root" when the dropdown closes.
type SessionChipPanel = "root" | "sessions" | "model" | "advanced";

/**
 * Chat properties. From `sm:` up the adjacent "Chat" label supplies the
 * subject; below it the glyph carries the chip alone, which is why it is the
 * half that stays — a word costs three times the width of the mark, and at
 * phone size the bar has none to spare.
 */
function ChatSettingsIcon() {
  return (
    <svg className="block w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7h4m4 0h10M3 17h10m4 0h4" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="17" r="2" />
    </svg>
  );
}

/**
 * One instrument: below/at/above the box default, with an attached star for
 * another harness. Unknown tier leaves the dial absent, never implying "same";
 * a known harness difference remains visible independently.
 */
function ModelGaugeIcon({ drift, offEngine }: { drift: "above" | "below" | "same" | null; offEngine: boolean }) {
  const needle = drift === "below" ? "M12 17 6.8 12.2" : drift === "above" ? "M12 17 17.2 12.2" : "M12 17V9.8";
  return (
    <svg className={drift === null ? "w-3 h-4 shrink-0" : "w-5 h-4 shrink-0"} viewBox={drift === null ? "17 0 13 24" : "0 0 30 24"} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {drift === null ? null : (
        <g transform="translate(0 -1.5)">
          <path d="M3 18a9 9 0 0 1 18 0M4.5 12l1.3.7M12 7v1.5M19.5 12l-1.3.7" />
          <path d={needle} />
          <circle cx="12" cy="17" r="1.5" fill="currentColor" stroke="none" />
        </g>
      )}
      {offEngine ? <path d="m23 1 1.2 3.8L28 6l-3.8 1.2L23 11l-1.2-3.8L18 6l3.8-1.2Z" fill="currentColor" stroke="none" /> : null}
    </svg>
  );
}

/** Menu-opens-here caret, matching the place pill's. */
function CaretIcon() {
  return (
    <svg className="w-3 h-3 shrink-0 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Root panel: New session, "Recent chats ›", "Model ›", divider, "Advanced ›". */
function RootPanel({
  onNewSession,
  onOpenSessions,
  currentModelLabel,
  modelSelectionDisabled,
  onOpenModel,
  onOpenAdvanced,
}: {
  onNewSession: () => void;
  onOpenSessions: () => void;
  currentModelLabel: string;
  modelSelectionDisabled: boolean;
  onOpenModel: () => void;
  onOpenAdvanced: () => void;
}) {
  return (
    <>
      <MenuItem id="bbx-session-new" onClick={onNewSession}>New chat</MenuItem>
      <MenuItem id="bbx-session-recent" onClick={onOpenSessions} keepOpen>
        <span className="flex justify-between gap-2 w-full">
          <span>Recent chats</span>
          <span className="text-warm-500">›</span>
        </span>
      </MenuItem>
      <MenuItem id="bbx-session-model" onClick={onOpenModel} keepOpen disabled={modelSelectionDisabled}>
        <span className="flex justify-between gap-2 w-full">
          <span>Model</span>
          <span className="text-warm-500 truncate">{currentModelLabel} ›</span>
        </span>
      </MenuItem>
      <MenuDivider />
      <MenuItem id="bbx-session-advanced" onClick={onOpenAdvanced} keepOpen>
        <span className="flex justify-between gap-2 w-full">
          <span>Advanced</span>
          <span className="text-warm-500">›</span>
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
        <span className="text-warm-500">‹ Recent chats</span>
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
}

/**
 * Exhaustive panel dispatch — a `switch` with no `default:` (the frontend
 * `.tsx` rule bans `default:` cases outright; TypeScript's
 * switch-exhaustiveness check still catches an unhandled new
 * `SessionChipPanel` member at compile time without one).
 */
function SessionChipBody(props: SessionChipBodyProps): ReactNode {
  const { panel, onNewSession, contextDir, onOpenSessions, currentModelLabel, modelSelectionDisabled, onOpenModel, selectedModel, boxDefault, canPin, canChooseEngine, enabledEngines, boxEngine, onChooseStart, onPinModel, agentEngine, onSelectModel, onOpenAdvanced, onBackToRoot, advancedProps } = props;
  switch (panel) {
    case "root":
      return <RootPanel onNewSession={onNewSession} onOpenSessions={onOpenSessions} currentModelLabel={currentModelLabel} modelSelectionDisabled={modelSelectionDisabled} onOpenModel={onOpenModel} onOpenAdvanced={onOpenAdvanced} />;
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
  const currentModelLabel = agentEngine === null
    ? "Unavailable"
    : chatModelLabel(agentEngine, { model: modelInForce, added: addedModels }) ?? "Unavailable";
  // `modelInForce` is null for a chat that FOLLOWS the box default — that is
  // what makes the label read "Default (Opus)" rather than naming the model —
  // so the drift comparison resolves it first. Without this the gauge was blank
  // for the most common case there is, which is most of why the old mark looked
  // unreliable. While status is still loading both are null and the comparison
  // correctly declines to answer.
  const drift = modelDrift({ model: modelInForce ?? boxDefault, boxDefault });
  const offEngine = engineDrift({ engine: agentEngine, boxEngine });
  // Keep the editorial title when available; the persistent "Chat" label
  // identifies the menu even without a title or at narrow widths.
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
          <button
            type="button"
            id="bbx-nav-session"
            data-bbx-reveal
            data-bbx-does="opens the session menu — new session, recent chats, model, advanced"
            onClick={toggle}
            className="min-h-[40px] min-w-[40px] px-2 sm:px-3 flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40"
            title={accessibleName}
            aria-label={accessibleName}
            {...ariaProps}
          >
            <ChatSettingsIcon />
            <span className="hidden sm:inline shrink-0 font-medium">Chat</span>
            {drift === null && !offEngine ? null : <ModelGaugeIcon drift={drift} offEngine={offEngine} />}
            {titled ? <span className="hidden sm:inline max-w-[11rem] truncate">{label}</span> : null}
            <CaretIcon />
          </button>
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

/**
 * The app bar's session chip — chat fiddling, named by its object
 * (docs/plans/top-nav-ia.md Track C2). Reshaped from the chat header's `⋯`
 * ChatMenu: same menu machinery (New session, Model ›, Advanced ›, the
 * panel-swap idiom), but the face is the session's own name, because an
 * unlabeled `⋯` stops working once every other menu face names its object.
 *
 * "Recent chats ›" lives here, as it did on the old `⋯` menu: the pill's
 * switch menu moves between landmarks and resumes each one's newest chat, so
 * it can't reach a sibling session in the landmark you're already in. Finding
 * *a session* is a chat concern; finding *a place* is the pill's.
 *
 * Face, following the bar's one-flexible-member rule: the session label
 * (truncated) from `sm:` up, a sliders icon below it — the chip is the third
 * thing to give way as the viewport narrows, after the box prefix and the
 * folder half's label.
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
import { chatModelOptions, type ChatAgentEngine } from "@shared/chat-models.js";
import { modelDrift } from "./model-drift";

// Single-panel submenu pattern: the dropdown swaps which set of rows it
// renders rather than spawning a flyout. Better on touch and avoids
// positioning complexity. Resets to "root" when the dropdown closes.
type SessionChipPanel = "root" | "sessions" | "model" | "advanced";

/** Three sliders — "settings for this thing", the phone-width face. */
function SlidersIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h12M20 17h0M16 5v4M10 10v4M18 15v4" />
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
      <MenuItem id="cb-session-new" onClick={onNewSession}>New session</MenuItem>
      <MenuItem id="cb-session-recent" onClick={onOpenSessions} keepOpen>
        <span className="flex justify-between gap-2 w-full">
          <span>Recent chats</span>
          <span className="text-warm-500">›</span>
        </span>
      </MenuItem>
      <MenuItem id="cb-session-model" onClick={onOpenModel} keepOpen disabled={modelSelectionDisabled}>
        <span className="flex justify-between gap-2 w-full">
          <span>Model</span>
          <span className="text-warm-500 truncate">{currentModelLabel} ›</span>
        </span>
      </MenuItem>
      <MenuDivider />
      <MenuItem id="cb-session-advanced" onClick={onOpenAdvanced} keepOpen>
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
      <MenuItem id="cb-session-recent-back" onClick={onBack} keepOpen>
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
  canSelect: boolean;
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
  const { panel, onNewSession, contextDir, onOpenSessions, currentModelLabel, modelSelectionDisabled, onOpenModel, selectedModel, boxDefault, canPin, canSelect, onPinModel, agentEngine, onSelectModel, onOpenAdvanced, onBackToRoot, advancedProps } = props;
  switch (panel) {
    case "root":
      return <RootPanel onNewSession={onNewSession} onOpenSessions={onOpenSessions} currentModelLabel={currentModelLabel} modelSelectionDisabled={modelSelectionDisabled} onOpenModel={onOpenModel} onOpenAdvanced={onOpenAdvanced} />;
    case "sessions":
      return <SessionsPanel onBack={onBackToRoot} contextDir={contextDir} />;
    case "model":
      return agentEngine === null ? null : <ModelPanel onBack={onBackToRoot} selectedModel={selectedModel} boxDefault={boxDefault} canPin={canPin} canSelect={canSelect} onPinModel={onPinModel} agentEngine={agentEngine} onSelectModel={onSelectModel} />;
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const navigate = useNavigate();
  const { boxSlug } = useParams({ strict: false });
  const currentModelLabel = agentEngine === null
    ? "Unavailable"
    : chatModelOptions(agentEngine).find((o) => o.model === modelInForce)?.label ?? "Unavailable";
  const drift = modelDrift({ model: modelInForce, boxDefault });
  // Editorial title or nothing: `label` is the husk's `title` (null until
  // the nightly chat review or a hand edit names the session). With no real
  // title the face is the sliders icon at every width — never a fabricated
  // name (boxholder call, 2026-08-03).
  const titled = label !== null && label !== "";
  // The mark is decoration; the meaning is in the name, so a screen reader
  // hears "below the box default" rather than a triangle.
  const driftPhrase = drift === null ? "" : ` — ${drift === "above" ? "above" : "below"} the box default`;
  const accessibleName = `${titled ? `Session: ${label}` : "Session menu"} · ${currentModelLabel}${driftPhrase}`;

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
            id="cb-nav-session"
            data-cb-reveal
            data-cb-does="opens the session menu — new session, recent chats, model, advanced"
            onClick={toggle}
            className="min-h-[40px] min-w-[40px] px-2 sm:px-3 flex items-center justify-center gap-1.5 rounded-full bg-white/10 border border-white/15 hover:bg-white/20 text-white/80 hover:text-white text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            title={accessibleName}
            aria-label={accessibleName}
            {...ariaProps}
          >
            <span className={titled ? "sm:hidden" : ""}>
              <SlidersIcon />
            </span>
            {drift === null ? null : (
              <span aria-hidden="true" className="text-[0.65rem] leading-none opacity-90">{drift === "above" ? "▲" : "▼"}</span>
            )}
            {titled ? (
              <>
                <span className="hidden sm:inline max-w-[11rem] truncate">{label}</span>
                <span className="hidden sm:flex">
                  <CaretIcon />
                </span>
              </>
            ) : null}
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
          canSelect={sessionId !== null}
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

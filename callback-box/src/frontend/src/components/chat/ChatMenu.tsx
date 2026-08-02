/**
 * The chat header's "..." menu: New session, "Recent chats" (session list
 * sub-panel), "Model" (moved here from `VoiceChip` in the chip polish round,
 * docs/plans/chat-header-chips.md follow-up — model choice isn't a voice I/O
 * concern), and "Advanced" (debug toggles, process controls). Voice settings
 * and Narration mode stay on `VoiceChip` (chunk 3 of
 * docs/plans/chat-header-chips.md). Self-contained — props in, callbacks out.
 */

import { useState, type ReactNode } from "react";
import { Dropdown } from "../ui/Dropdown";
import { MenuItem, MenuDivider } from "../ui/dropdown-menu-item";
import { SessionListPanel } from "./SessionListPanel";
import { AdvancedPanel } from "./ChatMenu-advanced-panels";
import { ModelPanel } from "./ChatMenu-model-panel";
import { MODEL_OPTIONS } from "./InteractiveChat-helpers";

// Single-panel submenu pattern: the dropdown swaps which set of rows it
// renders rather than spawning a flyout. Better on touch and avoids
// positioning complexity. Resets to "root" when the dropdown closes.
type ChatMenuPanel = "root" | "sessions" | "model" | "advanced";

/** Root panel: New session, "Recent chats ›", "Model", divider, "Advanced ›". */
function RootPanel({
  onNewSession,
  onOpenSessions,
  currentModelLabel,
  onOpenModel,
  onOpenAdvanced,
}: {
  onNewSession: () => void;
  onOpenSessions: () => void;
  currentModelLabel: string;
  onOpenModel: () => void;
  onOpenAdvanced: () => void;
}) {
  return (
    <>
      <MenuItem onClick={onNewSession}>New session</MenuItem>
      <MenuItem onClick={onOpenSessions} keepOpen>
        <span className="flex justify-between gap-2 w-full">
          <span>Recent chats</span>
          <span className="text-warm-500">›</span>
        </span>
      </MenuItem>
      <MenuItem onClick={onOpenModel} keepOpen>
        <span className="flex justify-between gap-2 w-full">
          <span>Model</span>
          <span className="text-warm-500 truncate">{currentModelLabel} ›</span>
        </span>
      </MenuItem>
      <MenuDivider />
      <MenuItem onClick={onOpenAdvanced} keepOpen>
        <span className="flex justify-between gap-2 w-full">
          <span>Advanced</span>
          <span className="text-warm-500">›</span>
        </span>
      </MenuItem>
    </>
  );
}

/** "Recent chats" sub-panel: back row + the lifted `SessionListPanel` body. */
function SessionsPanel({ onBack, contextDir }: { onBack: () => void; contextDir: string | null }) {
  return (
    <>
      <MenuItem onClick={onBack} keepOpen>
        <span className="text-warm-500">‹ Recent chats</span>
      </MenuItem>
      <MenuDivider />
      <SessionListPanel contextDir={contextDir} />
    </>
  );
}

interface ChatMenuBodyProps {
  panel: ChatMenuPanel;
  onNewSession: () => void;
  contextDir: string | null;
  onOpenSessions: () => void;
  currentModelLabel: string;
  onOpenModel: () => void;
  selectedModel: string | null;
  onSelectModel: (model: string | null) => void;
  onOpenAdvanced: () => void;
  onBackToRoot: () => void;
  advancedProps: Omit<Parameters<typeof AdvancedPanel>[0], "onBack">;
}

/**
 * Exhaustive panel dispatch — a `switch` with no `default:` (the frontend
 * `.tsx` rule bans `default:` cases outright; TypeScript's
 * switch-exhaustiveness check still catches an unhandled new
 * `ChatMenuPanel` member at compile time without one).
 */
function ChatMenuBody(props: ChatMenuBodyProps): ReactNode {
  const {
    panel, onNewSession, contextDir, onOpenSessions, currentModelLabel, onOpenModel, selectedModel, onSelectModel,
    onOpenAdvanced, onBackToRoot, advancedProps,
  } = props;
  switch (panel) {
    case "root":
      return (
        <RootPanel
          onNewSession={onNewSession}
          onOpenSessions={onOpenSessions}
          currentModelLabel={currentModelLabel}
          onOpenModel={onOpenModel}
          onOpenAdvanced={onOpenAdvanced}
        />
      );
    case "sessions":
      return <SessionsPanel onBack={onBackToRoot} contextDir={contextDir} />;
    case "model":
      return <ModelPanel onBack={onBackToRoot} selectedModel={selectedModel} onSelectModel={onSelectModel} />;
    case "advanced":
      return <AdvancedPanel onBack={onBackToRoot} {...advancedProps} />;
  }
}

/**
 * The chat header's "..." dropdown menu.
 */
export function ChatMenu({
  onNewSession,
  contextDir,
  selectedModel,
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
}: {
  onNewSession: () => void;
  contextDir: string | null;
  selectedModel: string | null;
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
}) {
  const [panel, setPanel] = useState<ChatMenuPanel>("root");
  const currentModelLabel = MODEL_OPTIONS.find((o) => o.model === selectedModel)?.label ?? "Default";

  return (
    <Dropdown
      align="right"
      // The Recent-chats panel renders two-line rows (message label, id,
      // timestamp, landmark) that the pre-chip session dropdown gave 28rem;
      // the other panels keep the compact menu width. The viewport clamp in
      // Dropdown still bounds it on narrow screens.
      width={panel === "sessions" ? "w-[28rem]" : "w-56"}
      panelIndex={panel === "root" ? 0 : 1}
      onClose={() => setPanel("root")}
      trigger={({ toggle, ariaProps }) => (
        <button
          type="button"
          onClick={toggle}
          className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full bg-white/10 border border-white/15 hover:bg-white/20 text-white/80 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          title="Chat menu"
          aria-label="Chat menu"
          {...ariaProps}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
          </svg>
        </button>
      )}
    >
      <ChatMenuBody
        panel={panel}
        onNewSession={onNewSession}
        contextDir={contextDir}
        onOpenSessions={() => setPanel("sessions")}
        currentModelLabel={currentModelLabel}
        onOpenModel={() => setPanel("model")}
        selectedModel={selectedModel}
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
        }}
      />
    </Dropdown>
  );
}

/**
 * The app bar's session chip — chat fiddling, named by its object
 * (docs/plans/top-nav-ia.md Track C2). Reshaped from the chat header's `⋯`
 * ChatMenu: same menu machinery (New session, Model ›, Advanced ›, the
 * panel-swap idiom), but the face is the session's own name, because an
 * unlabeled `⋯` stops working once every other menu face names its object.
 *
 * "Recent chats" is deliberately gone — the pill's switch menu owns finding
 * sessions now.
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
import { ModelPanel } from "./SessionChip-model-panel";
import { MODEL_OPTIONS } from "./InteractiveChat-helpers";

// Single-panel submenu pattern: the dropdown swaps which set of rows it
// renders rather than spawning a flyout. Better on touch and avoids
// positioning complexity. Resets to "root" when the dropdown closes.
type SessionChipPanel = "root" | "model" | "advanced";

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

/** Root panel: New session, "Model ›", divider, "Advanced ›". */
function RootPanel({
  onNewSession,
  currentModelLabel,
  onOpenModel,
  onOpenAdvanced,
}: {
  onNewSession: () => void;
  currentModelLabel: string;
  onOpenModel: () => void;
  onOpenAdvanced: () => void;
}) {
  return (
    <>
      <MenuItem onClick={onNewSession}>New session</MenuItem>
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

interface SessionChipBodyProps {
  panel: SessionChipPanel;
  onNewSession: () => void;
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
 * `SessionChipPanel` member at compile time without one).
 */
function SessionChipBody(props: SessionChipBodyProps): ReactNode {
  const {
    panel, onNewSession, currentModelLabel, onOpenModel, selectedModel, onSelectModel,
    onOpenAdvanced, onBackToRoot, advancedProps,
  } = props;
  switch (panel) {
    case "root":
      return (
        <RootPanel
          onNewSession={onNewSession}
          currentModelLabel={currentModelLabel}
          onOpenModel={onOpenModel}
          onOpenAdvanced={onOpenAdvanced}
        />
      );
    case "model":
      return <ModelPanel onBack={onBackToRoot} selectedModel={selectedModel} onSelectModel={onSelectModel} />;
    case "advanced":
      return <AdvancedPanel onBack={onBackToRoot} {...advancedProps} />;
  }
}

export interface SessionChipProps {
  /** The session's display name (`chat.bootstrap`'s `label`), or null before one exists. */
  label: string | null;
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
  onToggleDebugView: () => void;
  showDebugLog: boolean;
  onToggleDebugLog: () => void;
}

export const SessionChip = memo(function SessionChip(props: SessionChipProps) {
  const {
    label, onNewSession, selectedModel, onSelectModel, onStopProcess, onRestartProcess,
    onCompactSession, sessionId, running, busy, debugView, onToggleDebugView, showDebugLog, onToggleDebugLog,
  } = props;
  const [panel, setPanel] = useState<SessionChipPanel>("root");
  const currentModelLabel = MODEL_OPTIONS.find((o) => o.model === selectedModel)?.label ?? "Default";
  const faceLabel = label !== null && label !== "" ? label : "New chat";

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
          className="min-h-[40px] min-w-[40px] px-2 sm:px-3 flex items-center justify-center gap-1.5 rounded-full bg-white/10 border border-white/15 hover:bg-white/20 text-white/80 hover:text-white text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          title={faceLabel}
          aria-label={`Session: ${faceLabel}`}
          {...ariaProps}
        >
          <span className="sm:hidden">
            <SlidersIcon />
          </span>
          <span className="hidden sm:inline max-w-[11rem] truncate">{faceLabel}</span>
          <span className="hidden sm:flex">
            <CaretIcon />
          </span>
        </button>
      )}
    >
      <SessionChipBody
        panel={panel}
        onNewSession={onNewSession}
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
});

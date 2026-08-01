/**
 * The chat header's "..." menu: New session, "Recent chats" (session list
 * sub-panel), and "Advanced" (debug toggles, model/voice submenus wired to
 * the transcription tRPC config, process controls). Self-contained — props
 * in, callbacks out.
 */

import { useState, type ReactNode } from "react";
import { Dropdown, MenuItem, MenuDivider } from "../ui/Dropdown";
import { trpc } from "../../lib/trpc";
import { MODEL_OPTIONS } from "./InteractiveChat-helpers";
import { SessionListPanel } from "./SessionListPanel";
import {
  AdvancedPanel, ModelPanel, VoicePanel,
  type TranscriptionServiceOption, type HqTranscriptionOption,
} from "./ChatMenu-advanced-panels";

// Single-panel submenu pattern: the dropdown swaps which set of rows it
// renders rather than spawning a flyout. Better on touch and avoids
// positioning complexity. Resets to "root" when the dropdown closes.
// "model" and "voice" nest under "advanced" (their back row returns there);
// chunk 3 of docs/plans/chat-header-chips.md moves them out to the voice chip.
type ChatMenuPanel = "root" | "sessions" | "advanced" | "model" | "voice";

/** Root panel: New session, "Recent chats ›", divider, "Advanced ›". */
function RootPanel({
  onNewSession,
  onOpenSessions,
  onOpenAdvanced,
}: {
  onNewSession: () => void;
  onOpenSessions: () => void;
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
  onOpenAdvanced: () => void;
  onBackToRoot: () => void;
  onBackToAdvanced: () => void;
  advancedProps: Omit<Parameters<typeof AdvancedPanel>[0], "onBack">;
  modelProps: Omit<Parameters<typeof ModelPanel>[0], "onBack">;
  voiceProps: Omit<Parameters<typeof VoicePanel>[0], "onBack">;
}

/**
 * Exhaustive panel dispatch — a `switch` with no `default:` (the frontend
 * `.tsx` rule bans `default:` cases outright; TypeScript's
 * switch-exhaustiveness check still catches an unhandled new
 * `ChatMenuPanel` member at compile time without one).
 */
function ChatMenuBody(props: ChatMenuBodyProps): ReactNode {
  const { panel, onNewSession, contextDir, onOpenSessions, onOpenAdvanced, onBackToRoot, onBackToAdvanced, advancedProps, modelProps, voiceProps } = props;
  switch (panel) {
    case "root":
      return <RootPanel onNewSession={onNewSession} onOpenSessions={onOpenSessions} onOpenAdvanced={onOpenAdvanced} />;
    case "sessions":
      return <SessionsPanel onBack={onBackToRoot} contextDir={contextDir} />;
    case "advanced":
      return <AdvancedPanel onBack={onBackToRoot} {...advancedProps} />;
    case "model":
      return <ModelPanel onBack={onBackToAdvanced} {...modelProps} />;
    case "voice":
      return <VoicePanel onBack={onBackToAdvanced} {...voiceProps} />;
  }
}

/**
 * The chat header's "..." dropdown menu.
 */
export function ChatMenu({
  onNewSession,
  contextDir,
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
  selectedModel,
  onSelectModel,
  narrationEnabled,
  onToggleNarration,
}: {
  onNewSession: () => void;
  contextDir: string | null;
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
  selectedModel: string | null;
  onSelectModel: (model: string | null) => void;
  narrationEnabled: boolean;
  onToggleNarration: () => void;
}) {
  const transcriptionConfigQuery = trpc.transcription.config.useQuery();
  const setTranscriptionService = trpc.transcription.setService.useMutation();
  const setHqTranscriptionService = trpc.transcription.setHqService.useMutation();
  const utils = trpc.useUtils();
  const currentService = transcriptionConfigQuery.data?.service ?? null;
  const currentHqService = transcriptionConfigQuery.data?.hqService ?? null;

  const onSelectTranscriptionService = async (service: TranscriptionServiceOption) => {
    if (currentService === service) return;
    try {
      await setTranscriptionService.mutateAsync({ service });
      void utils.transcription.config.invalidate();
    } catch (e) {
      console.error("[chat] Failed to set transcription service", e);
    }
  };

  const onSelectHqTranscriptionService = async (hqService: HqTranscriptionOption) => {
    if (currentHqService === hqService) return;
    try {
      await setHqTranscriptionService.mutateAsync({ hqService });
      void utils.transcription.config.invalidate();
    } catch (e) {
      console.error("[chat] Failed to set HQ transcription service", e);
    }
  };

  const [panel, setPanel] = useState<ChatMenuPanel>("root");
  const currentModelLabel =
    MODEL_OPTIONS.find((o) => o.model === selectedModel)?.label ?? "Default";

  return (
    <Dropdown
      align="right"
      width="w-56"
      onClose={() => setPanel("root")}
      trigger={({ toggle, ariaProps }) => (
        <button
          type="button"
          onClick={toggle}
          className="p-1.5 rounded hover:bg-white/20 text-white/80 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
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
        onOpenAdvanced={() => setPanel("advanced")}
        onBackToRoot={() => setPanel("root")}
        onBackToAdvanced={() => setPanel("advanced")}
        advancedProps={{
          debugView,
          onToggleDebugView,
          narrationEnabled,
          onToggleNarration,
          currentModelLabel,
          onOpenModel: () => setPanel("model"),
          onOpenVoice: () => setPanel("voice"),
          showDebugLog,
          onToggleDebugLog,
          onCompactSession,
          busy,
          onRestartProcess,
          onStopProcess,
          running,
          sessionId,
        }}
        modelProps={{ selectedModel, onSelectModel }}
        voiceProps={{
          currentService,
          onSelectTranscriptionService,
          currentHqService,
          onSelectHqTranscriptionService,
        }}
      />
    </Dropdown>
  );
}

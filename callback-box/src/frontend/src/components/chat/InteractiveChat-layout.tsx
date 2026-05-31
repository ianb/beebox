/**
 * Layout chrome for InteractiveChat split out of the main component so its
 * body stays focused on state + effects: the header bar, the
 * status-banner/attachment stack above the composer, and the composer
 * section (desktop bar + mobile typing row). Presentational — every
 * interactive bit comes in as a prop.
 */

import { type ReactNode } from "react";
import { AttachmentPanel, FileAttachmentPanel, type AttachmentItem, type FileAttachmentItem } from "../ChatAttachments";
import { SelectionPanel } from "../ChatSelections";
import { type SelectionItem } from "../../lib/selection-serialize";
import { SessionListButton } from "../SessionListButton";
import { RecentFilesButton } from "../RecentFilesButton";
import { getTTSClient } from "../../lib/tts-client";
import { alarm } from "../../lib/earcons";
import { SchedulePill, NarrationStatusBadge, MuteButton, NewSessionButton, ChatContextLink } from "./InteractiveChat-controls";
import { ChatDebugMenu } from "./InteractiveChat-debug-menu";
import { ChatInputArea } from "./InteractiveChat-composer";
import { MobileTextareaRow } from "./InteractiveChat-mobile-row";
import type { OnZoomView } from "../ChatMessages";
import type { SessionEntry } from "../../api";
import type { ChatSchedule } from "../../../../core/chat-schedules";

export type { AttachmentItem, FileAttachmentItem };

export function ChatHeader(props: {
  effectiveContextDir: string | null;
  boxSlug: string | undefined;
  narrationEnabled: boolean;
  hqInFlight: boolean;
  onToggleNarration: () => void;
  muted: boolean;
  onToggleMute: () => void;
  messages: SessionEntry[];
  onZoomView: OnZoomView;
  onNewSession: () => void;
  debugMenu: ReactNode;
}) {
  const { effectiveContextDir, boxSlug, narrationEnabled, hqInFlight, onToggleNarration, muted, onToggleMute, messages, onZoomView, onNewSession, debugMenu } = props;
  return (
    <header className="flex-shrink-0 flex items-center gap-2 w-full max-w-5xl mx-auto px-4 py-2 bg-gradient-to-r from-accent via-coral to-primary">
      <h1 className="text-sm font-semibold text-white tracking-wide">Chat</h1>
      <ChatContextLink dir={effectiveContextDir} boxSlug={boxSlug ?? ""} />
      <NarrationStatusBadge enabled={narrationEnabled} hqInFlight={hqInFlight} onTurnOff={onToggleNarration} />
      <div className="flex-1" />
      <MuteButton muted={muted} onToggle={onToggleMute} />
      <RecentFilesButton
        entries={messages}
        onPanel={(summary) => onZoomView({
          target: { path: summary.path, viewer: null, params: {}, zoom: false },
          label: summary.title,
        })}
      />
      <SessionListButton />
      <NewSessionButton onClick={onNewSession} />
      {debugMenu}
    </header>
  );
}

export { ChatDebugMenu };

export function ChatStatusBanners(props: {
  error: string | null | undefined;
  transcriptionError: string | null | undefined;
  onDismissError: () => void;
  pendingCount: number;
  activeSchedules: ChatSchedule[];
  onCancelSchedule: (label: string) => void;
}) {
  const { error, transcriptionError, onDismissError, pendingCount, activeSchedules, onCancelSchedule } = props;
  return (
    <>
      {/* Error display */}
      {error || transcriptionError ? (
        <div className="px-4 py-2 bg-danger-50 border-t border-danger-light text-danger-dark text-sm">
          {error || transcriptionError}
          <button
            onClick={onDismissError}
            className="ml-2 text-danger hover:text-danger-dark"
          >
            dismiss
          </button>
        </div>
      ) : null}

      {/* Queued-message indicator: visible whenever the agent is busy with
          a previous turn and one or more user messages are sitting in the
          backend queue waiting to be processed. Without this the UI looks
          idle even though work is pending. */}
      {pendingCount > 0 ? (
        <div className="px-4 py-1.5 border-t border-info-light bg-info-50 text-info-dark text-xs">
          Agent is busy — {pendingCount === 1 ? "your message is queued" : `${pendingCount} messages are queued`}
        </div>
      ) : null}

      {/* Active schedules */}
      {activeSchedules.length > 0 ? (
        <div className="px-4 py-1.5 border-t border-warm-300 bg-warm-50 flex flex-wrap gap-1.5">
          {activeSchedules.map((s) => (
            <SchedulePill
              key={s.id}
              schedule={s}
              onCancel={() => onCancelSchedule(s.label)}
              onFired={() => {
                if (s.alarm) alarm.play();
                if (s.announce) {
                  getTTSClient().speak(s.announce).catch(() => {});
                }
              }}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

export interface ComposerSectionProps {
  attachments: AttachmentItem[];
  fileAttachments: FileAttachmentItem[];
  selections: SelectionItem[];
  onRemoveAttachment: (id: number) => void;
  onRemoveFileAttachment: (id: number) => void;
  onRemoveSelection: (id: number) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  typingMode: boolean;
  typingLocked: boolean;
  setTypingMode: (v: boolean) => void;
  setTypingLocked: React.Dispatch<React.SetStateAction<boolean>>;
  isTranscribing: boolean;
  inputArea: ReactNode;
  mobileRow: ReactNode;
}

export function ChatComposerSection(props: ComposerSectionProps) {
  const {
    attachments, fileAttachments, selections, onRemoveAttachment, onRemoveFileAttachment, onRemoveSelection,
    fileInputRef, onFileInputChange, typingMode, typingLocked, setTypingMode, setTypingLocked,
    isTranscribing, inputArea, mobileRow,
  } = props;
  return (
    <>
      {/* Image attachment panel: shows thumbnails above the composer */}
      <AttachmentPanel attachments={attachments} onRemove={onRemoveAttachment} />

      {/* Selection panel: pills for document text attached from the companion pane */}
      <SelectionPanel selections={selections} onRemove={onRemoveSelection} />

      {/* File attachment panel: chips for non-image uploads */}
      <FileAttachmentPanel attachments={fileAttachments} onRemove={onRemoveFileAttachment} />

      {/* Hidden file input — opened by the "+" attach button. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onFileInputChange}
      />

      {/* Input area: single row on desktop, button bar on mobile (hidden on mobile when typing) */}
      {inputArea}

      {/* Mobile typing row: replaces button bar when typing/transcribing */}
      {(typingMode || isTranscribing) ? (
        <div className="sm:hidden relative bg-gradient-to-r from-warm-100 via-warm-100 to-warm-200 px-3 pb-2">
          {typingMode ? (
            <div className="absolute -top-10 right-3 flex gap-1 z-10">
              <button
                onClick={() => setTypingLocked((v) => !v)}
                className="p-1.5 rounded-full bg-warm-100/90 text-warm-600 hover:bg-warm-300 shadow-sm backdrop-blur-sm"
                title={typingLocked ? "Unlock (close after send)" : "Lock open"}
              >
                {typingLocked ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => { setTypingMode(false); setTypingLocked(false); }}
                className="p-1.5 rounded-full bg-warm-100/90 text-warm-600 hover:bg-warm-300 shadow-sm backdrop-blur-sm"
                title="Close keyboard"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : null}
          {mobileRow}
        </div>
      ) : null}
    </>
  );
}

export { ChatInputArea, MobileTextareaRow };

/**
 * Top-level frame that arranges the companion panel, the chat column
 * (header, virtualized list, status banners, composer), and the floating
 * debug-log panel. Receives each region as a pre-built node so the parent
 * keeps ownership of the data wiring.
 */
export function ChatView(props: {
  hasCompanion: boolean;
  companionPanel: ReactNode;
  header: ReactNode;
  messageList: ReactNode;
  statusBanners: ReactNode;
  composerSection: ReactNode;
  debugLog: ReactNode;
}) {
  const { hasCompanion, companionPanel, header, messageList, statusBanners, composerSection, debugLog } = props;
  return (
    <>
      <div className={`h-full flex ${hasCompanion ? "flex-col md:flex-row" : "flex-col"} bg-gradient-to-b from-warm-50 to-warm-200 overflow-hidden`}>
        {hasCompanion ? companionPanel : null}
        <div className="flex-1 flex flex-col min-h-0 min-w-0 w-full">
          {/* Header with debug controls — centered at the same max-width as
              the message list and composer below. */}
          {header}
          {/* Messages area — virtualized */}
          {messageList}
          {/* Everything below the scroll pane (status banners + composer) is
              centered at the same max-width as the header and messages. */}
          <div className="flex flex-col w-full max-w-5xl mx-auto min-w-0">
            {statusBanners}
            {composerSection}
          </div>
        </div>
      </div>
      {debugLog}
    </>
  );
}

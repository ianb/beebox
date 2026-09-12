/**
 * Layout chrome for InteractiveChat split out of the main component so its
 * body stays focused on state + effects: the status-banner/attachment stack
 * above the composer and the composer section (desktop bar + mobile typing
 * row). Presentational — every interactive bit comes in as a prop.
 *
 * The chat header row is gone (docs/plans/top-nav-ia.md Track C2): its title,
 * context chip, voice chip and `⋯` menu now live in the single app bar, fed
 * by `ChatBarChrome`. `ChatView` keeps a visually-hidden `h1` so the page
 * still has a heading.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { AttachmentPanel, FileAttachmentPanel, type AttachmentItem, type FileAttachmentItem } from "./ChatAttachments";
import { SelectionPanel } from "./ChatSelections";
import { type SelectionItem } from "../../lib/selection/serialize";
import { getTTSClient } from "../../lib/audio/tts-client";
import { alarm } from "../../lib/audio/earcons";
import { SchedulePill } from "./InteractiveChat-controls";
import { ChatInputArea } from "./InteractiveChat-composer";
import { MobileTextareaRow } from "./InteractiveChat-mobile-row";
import type { ChatSchedule } from "@core/chat/schedules.js";

export type { AttachmentItem, FileAttachmentItem };

export function ChatStatusBanners(props: {
  error: string | null | undefined;
  transcriptionError: string | null | undefined;
  onDismissError: () => void;
  activeSchedules: ChatSchedule[];
  onCancelSchedule: (label: string) => void;
}) {
  const { error, transcriptionError, onDismissError, activeSchedules, onCancelSchedule } = props;
  return (
    <>
      {/* Error display */}
      {error || transcriptionError ? (
        <div className="px-4 py-2 bg-danger-50 border-t border-danger-light text-danger-dark text-sm">
          {/* Real space text node (not just margin) so a copy of the banner
              keeps the message and "dismiss" separated. */}
          {error || transcriptionError}{"  "}
          <button
            id="bbx-chat-error-dismiss"
            onClick={onDismissError}
            className="text-danger hover:text-danger-dark underline"
          >
            dismiss
          </button>
        </div>
      ) : null}

      {/* Queued-message indicator + stop controls now live in TargetStrip
          (docs/implemented-plans/input-extraction.md chunk 3) — the target's own status
          row, rendered by InteractiveChat-view.tsx just after this. */}

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

/**
 * Dismissible notice for attachments dropped when a persisted emission was
 * restored — their `tmp/…` upload no longer exists (housekeeping sweeps
 * uploads after 7 days), so they're never restored silently-broken
 * (docs/implemented-plans/input-extraction.md, chunk 4). Rendered in the composer
 * region, above the attachment panels, alongside `RecoveredDictation`.
 */
export function ExpiredAttachmentsNotice(props: { names: string[]; onDismiss: () => void }) {
  const { names, onDismiss } = props;
  if (names.length === 0) return null;
  return (
    <div className="mx-3 mb-2 px-3 py-1.5 bg-warm-100 border border-warm-300 rounded-lg text-warm-700 text-xs flex items-center justify-between gap-2">
      <span>
        {names.length} expired attachment{names.length === 1 ? "" : "s"} removed: {names.join(", ")}
      </span>
      <button id="bbx-chat-expired-attachments-dismiss" onClick={onDismiss} className="flex-shrink-0 text-warm-600 hover:text-warm-900 underline">
        dismiss
      </button>
    </div>
  );
}

export interface ComposerSectionProps {
  attachments: AttachmentItem[];
  pendingImageCount: number;
  fileAttachments: FileAttachmentItem[];
  selections: SelectionItem[];
  onRemoveAttachment: (id: number) => void;
  onRemoveFileAttachment: (id: number) => void;
  /** Re-run a failed file upload from the chip. */
  onRetryFileAttachment: (id: number) => void;
  onRemoveSelection: (id: number) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  typingMode: boolean;
  typingLocked: boolean;
  setTypingMode: (v: boolean) => void;
  setTypingLocked: React.Dispatch<React.SetStateAction<boolean>>;
  isTranscribing: boolean;
  /** Interrupted-dictation recovery widget, rendered above the composer. */
  recoveredDictation: ReactNode;
  /** Dismissible notice for attachments dropped on emission restore (swept `tmp/…` uploads), or null when none. */
  expiredAttachmentsNotice: ReactNode;
  inputArea: ReactNode;
  mobileRow: ReactNode;
}

export function ChatComposerSection(props: ComposerSectionProps) {
  const {
    attachments, pendingImageCount, fileAttachments, selections, onRemoveAttachment, onRemoveFileAttachment, onRetryFileAttachment, onRemoveSelection,
    fileInputRef, onFileInputChange, typingMode, typingLocked, setTypingMode, setTypingLocked,
    isTranscribing, recoveredDictation, expiredAttachmentsNotice, inputArea, mobileRow,
  } = props;
  return (
    <>
      {/* Recovery widget for an interrupted dictation (above all composer panels) */}
      {recoveredDictation}

      {/* Notice for attachments dropped on restore (swept before reload) */}
      {expiredAttachmentsNotice}

      {/* Image attachment panel: shows thumbnails above the composer */}
      <AttachmentPanel attachments={attachments} pendingCount={pendingImageCount} onRemove={onRemoveAttachment} />

      {/* Selection panel: pills for document text attached from the companion pane */}
      <SelectionPanel selections={selections} onRemove={onRemoveSelection} />

      {/* File attachment panel: chips for non-image uploads */}
      <FileAttachmentPanel attachments={fileAttachments} onRemove={onRemoveFileAttachment} onRetry={onRetryFileAttachment} />

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
                id="bbx-composer-keyboard-lock"
                onClick={() => setTypingLocked((v) => !v)}
                className={`p-1.5 rounded-full shadow-sm backdrop-blur-sm ${typingLocked ? "bg-primary text-white hover:bg-primary-dark" : "bg-warm-100/90 text-warm-600 hover:bg-warm-300"}`}
                aria-pressed={typingLocked}
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
                id="bbx-composer-keyboard-close"
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
 * (heading, list, status banners, composer), and the floating debug-log
 * panel. Receives each region as a pre-built node so the parent keeps
 * ownership of the data wiring.
 */
export function ChatView(props: {
  ambientRegion?: ReactNode;
  selectionNotice?: ReactNode;
  failedRegion?: ReactNode;
  workspace: ReactNode;
  /** The chat's app-bar publications (`ChatBarChrome`) — portals, no visible DOM here. */
  barChrome: ReactNode;
  statusBanners: ReactNode;
  composerSection: ReactNode;
  debugLog: ReactNode;
}) {
  const { workspace, barChrome, statusBanners, composerSection, debugLog } = props;
  const composer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = composer.current;
    if (!node) return;
    const measure = () => document.documentElement.style.setProperty("--bbx-composer-height", `${node.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => { observer.disconnect(); document.documentElement.style.removeProperty("--bbx-composer-height"); };
  }, []);
  return (
    <>
      <div className="bbx-conversation-desk h-full flex flex-col bg-gradient-to-b from-warm-50 to-warm-200 overflow-hidden">
        {barChrome}
        {workspace}
        <div ref={composer} className="bbx-composer-material flex flex-col w-full max-w-5xl mx-auto min-w-0">
          {props.selectionNotice}
          {props.ambientRegion}
          {props.failedRegion}
          {statusBanners}
          {composerSection}
        </div>
      </div>
      {debugLog}
    </>
  );
}

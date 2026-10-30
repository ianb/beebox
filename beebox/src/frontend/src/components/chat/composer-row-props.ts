/**
 * The props every composer text row shares: the desktop row, the phone row,
 * and `ChatInputArea`, which hands them down. One list, so a field added for
 * all three (the open question's `placeholder`, say) is one edit.
 */

import type { TranscriptionHandle } from "./InteractiveChat-composer/view";
import type { VoiceSegmentSend } from "./InteractiveChat-helpers";

export interface ComposerRowProps {
  isTranscribing: boolean;
  transcription: TranscriptionHandle;
  /** Chat target status is busy (streaming/refreshing) — a send will queue, not run immediately. */
  targetBusy: boolean;
  sendDisabledReason?: string;
  handleSend: () => void;
  handleCancelTranscription: () => void;
  /** Drops the persisted dictation draft when transcript is moved to input or sent. */
  clearDraft: () => void;
  onStopDictation: () => void;
  onVoiceSegmentSend: VoiceSegmentSend;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLTextAreaElement>) => void;
}

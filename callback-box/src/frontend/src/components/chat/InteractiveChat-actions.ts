/**
 * Composer + session action handlers for InteractiveChat: building and
 * dispatching the wrapped send payload, paste/drop image intake, the
 * zoomed-view / time-passed attribute builders, load-older paging, the
 * process/session controls, the composer keydown shortcuts, and the
 * textarea focus/scroll effects. Bundled into one hook so the component
 * body stays focused on composition.
 */

import { useEffect, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getChatHistory, restartChatSubprocess, type SessionEntry } from "../../api";
import { extractImageFiles } from "../../lib/image-paste";
import { unlockAudioContext } from "../../lib/audio/context";
import { href, toSearch } from "../../lib/routing";
import { newMessageId } from "./InteractiveChat-helpers";
import { type AttachmentItem, type FileAttachmentItem } from "./ChatAttachments";
import { type SelectionItem } from "../../lib/selection/serialize";
import { useTranscriptAutoscroll } from "../../hooks/useTranscriptAutoscroll";
import { createTypedEmission, type Emission } from "../../input/emission";
import type { InputStore } from "./input-store";
import type { ChatEvent } from "../../machines/chat-types";

interface ChatActionsOpts {
  send: (event: ChatEvent) => void;
  sessionId: string | null;
  boxSlug: string | undefined;
  effectiveContextDir: string | null;
  messages: SessionEntry[];
  totalEntries: number;
  loadingOlder: boolean;
  setLoadingOlder: React.Dispatch<React.SetStateAction<boolean>>;
  inputStore: InputStore;
  attachments: AttachmentItem[];
  fileAttachments: FileAttachmentItem[];
  selections: SelectionItem[];
  resetAttachments: () => void;
  resetSelections: () => void;
  addImageFiles: (files: File[]) => void;
  onSend: () => void;
  isTranscribing: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  transcriptTick: string;
  typingMode: boolean;
  typingLocked: boolean;
  setTypingMode: React.Dispatch<React.SetStateAction<boolean>>;
  setScrollToBottomTrigger: React.Dispatch<React.SetStateAction<number>>;
  /** The one send funnel — assembly happens target-side (InteractiveChat-dispatch.ts). */
  dispatchEmission: (emission: Emission) => void;
}

export function useChatActions(opts: ChatActionsOpts) {
  const {
    send, sessionId, boxSlug, effectiveContextDir, messages, totalEntries, loadingOlder, setLoadingOlder,
    inputStore, attachments, fileAttachments, selections, resetAttachments, resetSelections, addImageFiles,
    onSend, isTranscribing, textareaRef, transcriptTick, typingMode, typingLocked, setTypingMode,
    setScrollToBottomTrigger, dispatchEmission,
  } = opts;
  const navigate = useNavigate();

  const handleSend = useCallback(() => {
    const text = inputStore.get().trim();
    if (!text && attachments.length === 0 && fileAttachments.length === 0 && selections.length === 0) return;
    onSend();
    unlockAudioContext();

    const emission = createTypedEmission({
      text,
      // UI attachments become the wire-format images payload.
      images: attachments.map((a) => ({ id: a.id, mimeType: a.mimeType, dataBase64: a.dataBase64 })),
      files: fileAttachments.map((f) => ({ id: f.id, path: f.path })),
      selections,
    });

    resetAttachments();
    resetSelections();
    inputStore.set("");
    dispatchEmission(emission);
    setScrollToBottomTrigger((n) => n + 1);
    if (typingMode && !typingLocked) {
      setTypingMode(false);
    }
  }, [inputStore, attachments, fileAttachments, selections, dispatchEmission, typingMode, typingLocked, onSend, resetAttachments, resetSelections, setScrollToBottomTrigger, setTypingMode]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const images = extractImageFiles(e.clipboardData);
    if (images.length === 0) return;
    e.preventDefault();
    void addImageFiles(images);
  }, [addImageFiles]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    const images = extractImageFiles(e.dataTransfer);
    if (images.length === 0) return;
    e.preventDefault();
    void addImageFiles(images);
  }, [addImageFiles]);

  const handleInterrupt = useCallback(() => {
    send({ type: "INTERRUPT" });
  }, [send]);

  const handleNewSession = useCallback(() => {
    const search: { session: string; contextDir?: string } = { session: "new" };
    // Propagate the binding even when it's the empty-string root binding,
    // so a fresh chat from a root-bound session stays root-bound rather
    // than becoming an unbound legacy chat.
    if (effectiveContextDir !== null) search.contextDir = effectiveContextDir;
    // navigate()'s promise only rejects on a superseded/redirected
    // navigation (not a user-facing failure) -- fire-and-forget.
    void navigate({
      to: href(`/${boxSlug}/chat`),
      search: toSearch(search),
    });
  }, [navigate, boxSlug, effectiveContextDir]);

  const handleStopProcess = useCallback(() => {
    send({ type: "INTERRUPT" });
  }, [send]);

  const handleRestartProcess = useCallback(() => {
    if (!sessionId) return;
    // User-initiated action (policy rule 5): a silent no-op here used to
    // leave the user thinking the restart happened. There's no generic
    // action-error banner in this component today (the machine's `error`
    // context is stream-specific and gated to the "streaming" state, so
    // dispatching STREAM_ERROR here would silently no-op outside a live
    // turn) -- log at error level as the interim signal until a real
    // user-facing surfacing exists (see issues/ for the follow-up).
    restartChatSubprocess({ sessionId }).catch((e: unknown) => {
      console.error(`[chat] restart process failed for session ${sessionId}:`, e);
    });
  }, [sessionId]);

  const handleCompactSession = useCallback(() => {
    // /compact must be the first characters of the text, with no wrapping —
    // the backend /send route detects leading-slash messages and skips
    // user-attr + pending-schedules injection.
    send({ type: "SEND", message: "/compact", messageId: newMessageId() });
  }, [send]);

  const handleLoadOlder = useCallback(() => {
    if (loadingOlder) return;
    if (!sessionId) return;
    setLoadingOlder(true);
    // Load all history up to the current start point
    const currentCount = messages.length;
    const olderCount = totalEntries - currentCount;
    const chunkSize = Math.min(olderCount, 40);
    // Fetch a window ending just before current messages
    const offset = Math.max(0, olderCount - chunkSize);
    const limit = olderCount - offset;
    getChatHistory({ sessionId, offset, limit })
      .then((result) => {
        send({ type: "PREPEND_MESSAGES", messages: result.entries });
      })
      .catch((e: unknown) => {
        console.warn(`[chat] load-older history fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => setLoadingOlder(false));
  }, [loadingOlder, messages.length, totalEntries, send, sessionId, setLoadingOlder]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isTranscribing) {
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "j" && e.ctrlKey) {
        e.preventDefault();
        const ta = textareaRef.current;
        if (ta) {
          const { selectionStart, selectionEnd, value } = ta;
          const newValue = value.slice(0, selectionStart) + "\n" + value.slice(selectionEnd);
          inputStore.set(newValue);
          requestAnimationFrame(() => {
            ta.selectionStart = ta.selectionEnd = selectionStart + 1;
          });
        }
      }
    },
    [handleSend, isTranscribing, textareaRef, inputStore]
  );

  useTextareaFocus({ isTranscribing, typingMode, textareaRef, transcriptTick });

  return {
    handleSend, handlePaste, handleDrop,
    handleInterrupt, handleNewSession, handleStopProcess, handleRestartProcess,
    handleCompactSession, handleLoadOlder, handleKeyDown,
  };
}

/**
 * Keep the composer textarea focused when it's visible (Safari needs a short
 * delay after the element appears for the keyboard to open) and scroll it to
 * the bottom as the live transcript streams in.
 */
function useTextareaFocus(opts: {
  isTranscribing: boolean;
  typingMode: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  transcriptTick: string;
}) {
  const { isTranscribing, typingMode, textareaRef, transcriptTick } = opts;

  // On mobile (< sm), the textarea is only visible in typing mode or while transcribing.
  useEffect(() => {
    if (!isTranscribing && textareaRef.current) {
      // Only focus if the textarea is actually visible (not hidden by mobile bar)
      if (textareaRef.current.offsetParent !== null) {
        textareaRef.current.focus();
      }
    }
    if (typingMode) {
      setTimeout(() => {
        const ta = textareaRef.current;
        if (ta !== null) ta.focus();
      }, 100);
    }
  }, [isTranscribing, typingMode, textareaRef]);

  useTranscriptAutoscroll({ isTranscribing, textareaRef, transcriptTick });
}

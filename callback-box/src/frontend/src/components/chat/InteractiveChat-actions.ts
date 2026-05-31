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
import { getChatHistory, restartChatSubprocess, type SessionEntry, type ChatImageAttachment } from "../../api";
import { extractImageFiles } from "../../lib/image-paste";
import { unlockAudioContext } from "../../lib/audio-context";
import { href } from "../../lib/routing";
import { localTime, newMessageId } from "./InteractiveChat-helpers";
import { type AttachmentItem, type FileAttachmentItem } from "../ChatAttachments";
import { applySelections, type SelectionItem } from "../../lib/selection-serialize";
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
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  attachments: AttachmentItem[];
  fileAttachments: FileAttachmentItem[];
  selections: SelectionItem[];
  resetAttachments: () => void;
  resetSelections: () => void;
  addImageFiles: (files: File[]) => void;
  turnTakingRef: React.MutableRefObject<boolean>;
  isTranscribing: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  transcriptTick: string;
  typingMode: boolean;
  typingLocked: boolean;
  setTypingMode: React.Dispatch<React.SetStateAction<boolean>>;
  setScrollToBottomTrigger: React.Dispatch<React.SetStateAction<number>>;
  zoomedViewAttr: () => string;
  timePassedAttr: () => string;
}

export function useChatActions(opts: ChatActionsOpts) {
  const {
    send, sessionId, boxSlug, effectiveContextDir, messages, totalEntries, loadingOlder, setLoadingOlder,
    input, setInput, attachments, fileAttachments, selections, resetAttachments, resetSelections, addImageFiles,
    turnTakingRef, isTranscribing, textareaRef, transcriptTick, typingMode, typingLocked, setTypingMode,
    setScrollToBottomTrigger, zoomedViewAttr, timePassedAttr,
  } = opts;
  const navigate = useNavigate();

  // doSend with attachments — used by handleSend below.
  const doSendWithImages = useCallback(
    (wrapped: string, images: ChatImageAttachment[]) => {
      const messageId = newMessageId();
      if (images.length > 0) {
        send({ type: "SEND", message: wrapped, messageId, images });
      } else {
        send({ type: "SEND", message: wrapped, messageId });
      }
    },
    [send]
  );

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text && attachments.length === 0 && fileAttachments.length === 0 && selections.length === 0) return;
    turnTakingRef.current = false;
    unlockAudioContext();

    // Convert UI attachments to the wire-format images payload.
    const images: ChatImageAttachment[] = attachments.map((a) => ({
      id: a.id,
      mimeType: a.mimeType,
      dataBase64: a.dataBase64,
    }));

    // Fold attached selections in: `[selectionN]` tokens become inline
    // <user-selection> elements; any without a surviving token are appended.
    const body = applySelections(text, { selections });
    const typed = `<typed local-time="${localTime()}"${zoomedViewAttr()}${timePassedAttr()}>${body}</typed>`;
    // File attachments emit a sibling <attachments> block of markdown-style
    // reference links so the agent sees the path each [fileN] token resolves
    // to without us having to inline the file's bytes anywhere.
    const attachmentsBlock = fileAttachments.length > 0
      ? "\n<attachments>\n" +
        fileAttachments.map((f) => `[file${f.id}]: ${f.path}`).join("\n") +
        "\n</attachments>"
      : "";
    const wrapped = typed + attachmentsBlock;

    resetAttachments();
    resetSelections();
    setInput("");
    doSendWithImages(wrapped, images);
    setScrollToBottomTrigger((n) => n + 1);
    if (typingMode && !typingLocked) {
      setTypingMode(false);
    }
  }, [input, attachments, fileAttachments, selections, doSendWithImages, zoomedViewAttr, timePassedAttr, typingMode, typingLocked, turnTakingRef, resetAttachments, resetSelections, setInput, setScrollToBottomTrigger, setTypingMode]);

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
    navigate({
      to: href(`/${boxSlug}/chat`),
      search: search as never,
    });
  }, [navigate, boxSlug, effectiveContextDir]);

  const handleStopProcess = useCallback(() => {
    send({ type: "INTERRUPT" });
  }, [send]);

  const handleRestartProcess = useCallback(() => {
    if (!sessionId) return;
    restartChatSubprocess({ sessionId }).catch(() => {});
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
      .catch(() => {})
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
          setInput(newValue);
          requestAnimationFrame(() => {
            ta.selectionStart = ta.selectionEnd = selectionStart + 1;
          });
        }
      }
    },
    [handleSend, isTranscribing, textareaRef, setInput]
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

  // Scroll textarea to bottom as transcript streams in
  useEffect(() => {
    if (isTranscribing && textareaRef.current) {
      const el = textareaRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [isTranscribing, transcriptTick, textareaRef]);
}

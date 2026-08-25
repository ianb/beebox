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
import { extractTransferFiles } from "../../lib/image-paste";
import { unlockAudioContext } from "../../lib/audio/context";
import { href, toSearch } from "../../lib/routing";
import { newMessageId } from "./InteractiveChat-helpers";
import { toastError } from "../ui/toast-store";
import { type SelectionItem } from "../../lib/selection/serialize";
import { useTranscriptAutoscroll } from "../../hooks/useTranscriptAutoscroll";
import { createTypedEmission, draftAttachments, type Emission } from "../../input/emission";
import type { InputStore } from "./input-store";
import type { EmissionStore } from "../../input/emission-store";
import { MAX_RETAINED_MESSAGES, type ChatEvent } from "../../machines/chat-types";

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
  /** Read at send-time via `.get()` — not a reactive prop, see module doc. */
  emissionStore: EmissionStore;
  selections: SelectionItem[];
  resetAttachments: () => void;
  resetSelections: () => void;
  /** Composer file ingest — routing decides inline vs. batch (`file-routing.ts`). */
  addFiles: (files: File[]) => void;
  onSend: () => void;
  isTranscribing: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  transcriptTick: string;
  typingMode: boolean;
  typingLocked: boolean;
  setTypingMode: React.Dispatch<React.SetStateAction<boolean>>;
  setSendSignal: React.Dispatch<React.SetStateAction<number>>;
  /** The one send funnel — assembly happens target-side (InteractiveChat-dispatch.ts). */
  dispatchEmission: (emission: Emission) => void;
}

export function useChatActions(opts: ChatActionsOpts) {
  const {
    send, sessionId, boxSlug, effectiveContextDir, messages, totalEntries, loadingOlder, setLoadingOlder,
    inputStore, emissionStore, selections, resetAttachments, resetSelections, addFiles,
    onSend, isTranscribing, textareaRef, transcriptTick, typingMode, typingLocked, setTypingMode,
    setSendSignal, dispatchEmission,
  } = opts;
  const navigate = useNavigate();

  const handleSend = useCallback(() => {
    const text = inputStore.get().trim();
    // Point-in-time read, not a subscription — attachments aren't reactive
    // props here (see module doc); this only runs on an actual send click.
    const { images: attachments, files: fileAttachments } = emissionStore.get();
    if (!text && attachments.length === 0 && fileAttachments.length === 0 && selections.length === 0) return;
    onSend();
    unlockAudioContext();

    const emission = createTypedEmission({
      text,
      // UI attachments become the wire-format payloads.
      ...draftAttachments({ images: attachments, files: fileAttachments }),
      selections,
    });

    resetAttachments();
    resetSelections();
    inputStore.set("");
    dispatchEmission(emission);
    setSendSignal((n) => n + 1);
    if (typingMode && !typingLocked) {
      setTypingMode(false);
    }
  }, [inputStore, emissionStore, selections, dispatchEmission, typingMode, typingLocked, onSend, resetAttachments, resetSelections, setSendSignal, setTypingMode]);

  // Clicking a suggested opener is typing it and pressing enter: seed the
  // composer store, then run the exact same send funnel — so an opener carries
  // any attachment/selection the person had already staged, and the composer is
  // left empty afterwards like a normal send.
  const handleSendOpener = useCallback((text: string) => {
    inputStore.set(text);
    handleSend();
  }, [inputStore, handleSend]);

  // Paste and drop take WHATEVER files came with the event, not just images:
  // routing (`file-routing.ts`) sends a non-image set to the bulk batch, so
  // filtering here would silently discard a dropped PDF instead of filing it.
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = extractTransferFiles(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    void addFiles(files);
  }, [addFiles]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    const files = extractTransferFiles(e.dataTransfer);
    if (files.length === 0) return;
    e.preventDefault();
    void addFiles(files);
  }, [addFiles]);

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
    // User-initiated action (policy rule 5): surface a failed restart to the
    // user, not just the console -- a silent no-op used to leave them thinking
    // the restart happened. The machine's `error` context is stream-specific
    // (gated to the "streaming" state), so the generic toast channel is the
    // right surface here.
    restartChatSubprocess({ sessionId }).catch((e: unknown) => {
      console.error(`[chat] restart process failed for session ${sessionId}:`, e);
      toastError("Failed to restart the agent process", { cause: e });
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
    // The tab keeps a bounded window (chat-types.ts MAX_RETAINED_MESSAGES), so
    // once it is full a further page would be discarded by the machine's
    // prepend reducer. Stop fetching rather than spending a round trip on
    // entries that can't be retained. The header hides at the same threshold,
    // so a user only reaches this guard by racing the last click.
    if (messages.length >= MAX_RETAINED_MESSAGES) return;
    setLoadingOlder(true);
    // One bounded page per click, walking backwards from the current window.
    // `totalEntries` is exact (the server counts every entry even though it
    // retains only the window), and a 40-entry page is far under the server's
    // hard retention ceiling, so every older entry stays reachable — the
    // affordance can't offer more than it can fetch.
    const currentCount = messages.length;
    const olderCount = totalEntries - currentCount;
    const chunkSize = Math.min(olderCount, 40);
    // Fetch a window ending just before current messages
    const offset = Math.max(0, olderCount - chunkSize);
    const limit = olderCount - offset;
    getChatHistory({ sessionId, slice: { mode: "page", offset, limit } })
      .then((result) => {
        send({ type: "PREPEND_MESSAGES", messages: result.entries });
      })
      .catch((e: unknown) => {
        // User-initiated action (policy rule 5): the user clicked "load older"
        // and is waiting on it -- surface the failure, don't just log.
        console.error(`[chat] load-older history fetch failed: ${e instanceof Error ? e.message : String(e)}`);
        toastError("Failed to load earlier messages", { cause: e });
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
    handleSend, handleSendOpener, handlePaste, handleDrop,
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

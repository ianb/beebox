/**
 * Composer + session action handlers for InteractiveChat: building and
 * dispatching the wrapped send payload, paste/drop image intake, the
 * zoomed-view / time-passed attribute builders, load-older paging, the
 * process/session controls, the composer keydown shortcuts, and the
 * textarea focus/scroll effects. Bundled into one hook so the component
 * body stays focused on composition.
 */

import { useEffect, useCallback, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getChatHistory, restartChatSubprocess, type SessionEntry } from "../../api";
import { extractTransferFiles } from "../../lib/image-paste";
import { unlockAudioContext } from "../../lib/audio/context";
import { href, toSearch } from "../../lib/routing";
import { newMessageId } from "./InteractiveChat-helpers";
import { toastError } from "../ui/toast-store";
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
  resetAttachments: () => void;
  resetSelections: () => void;
  /** Composer file ingest — routing decides inline vs. upload (`file-routing.ts`). */
  addFiles: (files: File[]) => void;
  /** Resolves when no file attachment is still uploading; a send waits on it. */
  awaitPendingUploads: () => Promise<void>;
  onSend: () => void;
  isTranscribing: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  transcriptTick: string;
  typingMode: boolean;
  typingLocked: boolean;
  setTypingMode: React.Dispatch<React.SetStateAction<boolean>>;
  /** The one send funnel — assembly happens target-side (InteractiveChat-dispatch.ts). */
  dispatchEmission: (emission: Emission) => void;
}

export function useChatActions(opts: ChatActionsOpts) {
  const {
    send, sessionId, boxSlug, effectiveContextDir, messages, totalEntries, loadingOlder, setLoadingOlder,
    inputStore, emissionStore, resetAttachments, resetSelections, addFiles,
    onSend, isTranscribing, textareaRef, transcriptTick, typingMode, typingLocked, setTypingMode,
    dispatchEmission, awaitPendingUploads,
  } = opts;
  const navigate = useNavigate();

  /**
   * True while a send is waiting on uploads. Sending is no longer instantaneous
   * — it can sit on a slow upload for seconds — so a second Enter would
   * otherwise start a second send that wakes up after the first cleared the
   * composer and dispatches an EMPTY message (nothing downstream rejects one).
   */
  const sendInFlightRef = useRef(false);

  const runSend = useCallback(async (): Promise<void> => {
    if (sendInFlightRef.current) return;
    // Point-in-time read, not a subscription — attachments aren't reactive
    // props here (see module doc); this only runs on an actual send click.
    const pre = emissionStore.get();
    if (!inputStore.get().trim() && pre.images.length === 0 && pre.files.length === 0 && pre.selections.length === 0) return;
    unlockAudioContext();

    // Hold until every file attachment has finished uploading. A file's token
    // goes into the text the moment it is picked, so a send can land on one
    // whose bytes are still moving — and `draftAttachments` would drop it,
    // sending a token that references nothing. The composer stays live and the
    // chips keep showing progress, so anything typed during the wait joins this
    // same message.
    sendInFlightRef.current = true;
    try {
      await awaitPendingUploads();
    } finally {
      sendInFlightRef.current = false;
    }

    // Re-read EVERYTHING after the wait — text may have grown, a selection may
    // have been added or dropped, and the file states have certainly changed.
    // Reading selections from the store rather than the `selections` prop
    // matters here: the prop is the value captured when this callback was
    // built, so a selection made during the wait would ship its token with no
    // payload behind it.
    const { images: attachments, files: fileAttachments, selections: liveSelections } = emissionStore.get();
    const text = inputStore.get().trim();
    const failed = fileAttachments.filter((f) => f.state.status === "failed");
    if (failed.length > 0) {
      // Refuse rather than quietly send a message missing the files it names.
      // Everything stays put, so the chips' retry is right there.
      const names = failed.map((f) => f.originalName).join(", ");
      toastError(`Not sent — ${names} didn't upload. Retry or remove ${failed.length === 1 ? "it" : "them"}, then send.`);
      return;
    }
    // The composer can have been emptied while we waited — another send path
    // (a voice keyword fire) clears it wholesale.
    if (!text && attachments.length === 0 && fileAttachments.length === 0 && liveSelections.length === 0) return;

    // Only now has a message definitely gone out: `onSend` tells the voice
    // machine a send happened, and a refusal above must not claim one did.
    onSend();
    const emission = createTypedEmission({
      text,
      // UI attachments become the wire-format payloads.
      ...draftAttachments({ images: attachments, files: fileAttachments }),
      selections: liveSelections,
    });

    resetAttachments();
    resetSelections();
    inputStore.set("");
    dispatchEmission(emission);
    if (typingMode && !typingLocked) {
      setTypingMode(false);
    }
  }, [inputStore, emissionStore, dispatchEmission, typingMode, typingLocked, onSend, resetAttachments, resetSelections, setTypingMode, awaitPendingUploads]);

  /**
   * The send every caller uses. Void-returning: sending now waits on in-flight
   * uploads, but a click handler, a key handler and a composer prop all have
   * nothing to resume on, and `runSend` reports its own failures with a toast.
   */
  const handleSend = useCallback(() => { void runSend(); }, [runSend]);

  // Clicking a suggested opener is typing it and pressing enter: seed the
  // composer store, then run the exact same send funnel — so an opener carries
  // any attachment/selection the person had already staged, and the composer is
  // left empty afterwards like a normal send.
  const handleSendOpener = useCallback((text: string) => {
    inputStore.set(text);
    handleSend();
  }, [inputStore, handleSend]);

  // Paste and drop take WHATEVER files came with the event, not just images:
  // routing (`file-routing.ts`) gives a non-image the upload representation, so
  // filtering here would silently discard a dropped PDF instead of attaching it.
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
      toastError("Couldn't restart the chat process", { cause: e });
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

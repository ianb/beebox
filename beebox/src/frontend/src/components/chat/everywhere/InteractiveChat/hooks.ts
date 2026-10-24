/**
 * Custom hooks that carve InteractiveChat's state + effects into cohesive
 * units: model/feature selection, schedule polling, and composer
 * attachments. Each follows rules-of-hooks (called unconditionally from the
 * component body in a stable order) and owns its own state slice.
 */

import { errorMessage } from "@shared/error-guards";
import { useState, useEffect, useCallback } from "react";
import { getChatHistory, type SessionEntry } from "../../../../api";
import { trpcClient } from "../../../../lib/trpc/client";
import { chatTailSlice } from "../../../../machines/chatMachine/machine.js";
import { toastError } from "../../../ui/toast-store";
import type { ChatSchedule } from "@core/chat/schedules/core.js";
import { readStoredFlag, writeStoredFlag, type StoredFlag } from "../../../../lib/stored-flag";

interface ChatSendFn {
  (event: { type: "SET_MESSAGES"; messages: SessionEntry[]; sessionId: string | null }): void;
}

const CHAT_MUTED: StoredFlag = { storage: () => (typeof window === "undefined" ? null : localStorage), key: "chat-muted" };

/**
 * Mute toggle persisted to localStorage (key `chat-muted`). SSR-safe initial
 * read.
 */
export function useChatMute() {
  const [muted, setMuted] = useState<boolean>(() => readStoredFlag(CHAT_MUTED));
  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      writeStoredFlag(CHAT_MUTED, next);
      return next;
    });
  }, []);
  return { muted, handleToggleMute };
}

/**
 * Active chat schedules: polled on mount + after each turn, with a 3s
 * fallback poll for fired schedules (covers missed SSE) and a cancel action.
 */
export function useChatSchedules(opts: {
  messages: SessionEntry[];
  /** False while the chat machine is still loading — `messages` isn't the transcript yet. */
  loaded: boolean;
  isStreaming: boolean;
  send: ChatSendFn;
}) {
  const { messages, loaded } = opts;
  const [activeSchedules, setActiveSchedules] = useState<ChatSchedule[]>([]);

  const fetchSchedules = useCallback(() => {
    trpcClient.chat.schedules.query()
      .then((data) => {
        setActiveSchedules(data.schedules);
      })
      .catch((e: unknown) => {
        console.warn(`[chatfsm] fetch-schedules failed: ${errorMessage(e)}`);
      });
  }, []);

  // Fetch on mount, and whenever a NEW entry lands. Keyed on the newest entry's
  // uuid, not the array: `messages` gets a fresh identity on every history
  // fetch (initial load, refresh, server push), which refired this on every one
  // of them — a duplicate request moments after mount. Schedules are set by
  // the agent during a turn (`bbx remind --here` or a `<schedule>` tag), and a
  // turn always ends with a new transcript entry, so a re-read that ends on
  // the same entry can't change them.
  // (The count would miss the case that matters most for a long chat: at the
  // HISTORY_TAIL cap, a new turn pushes the oldest entry out and the length
  // never moves.)
  //
  // Skipped while the machine loads: `messages` is the empty pre-load array
  // then, and fetching on it only to fetch again a tick later when the
  // transcript lands is the second half of the same duplicate.
  const newestUuid = messages.at(-1)?.uuid ?? null;
  useEffect(() => {
    if (!loaded) return;
    fetchSchedules();
  }, [loaded, newestUuid, fetchSchedules]);

  // NOTE: a former "poll /chat/history after a schedule fires" fallback lived
  // here but was inert — it fetched history with no session id, which the
  // endpoint rejected, so it never refreshed anything. Schedule-fired turns
  // arrive over the WS event stream (events.subscribe); the fallback is dropped
  // rather than ported.

  const handleCancelSchedule = useCallback((label: string) => {
    // User-initiated action (rule 5): surface a failed cancel via the toast
    // channel -- otherwise the schedule pill stays, but the user has no signal
    // that their cancel didn't take.
    trpcClient.chat.cancelSchedule.mutate({ label })
      .then(() => fetchSchedules())
      .catch((e: unknown) => {
        console.error(`[chatfsm] cancel-schedule "${label}" failed: ${errorMessage(e)}`);
        toastError(`Failed to cancel the "${label}" schedule`, { cause: e });
      });
  }, [fetchSchedules]);

  return { activeSchedules, fetchSchedules, handleCancelSchedule };
}

/**
 * Poll history every 5s while pending messages exist, as a fallback for a
 * missed chat-complete SSE — SET_MESSAGES reconcile drops them as the server
 * catches up.
 */
export function usePendingMessagePoll(opts: {
  pendingCount: number;
  sessionId: string | null;
  send: ChatSendFn;
}) {
  const { pendingCount, sessionId, send } = opts;
  useEffect(() => {
    if (pendingCount === 0) return;
    if (!sessionId) return;
    const poll = () => {
      getChatHistory({ sessionId, slice: chatTailSlice() })
        .then((data) => {
          send({ type: "SET_MESSAGES", messages: data.entries, sessionId: data.sessionId });
        })
        .catch((e: unknown) => {
          // Poll retries on its own timer, but retry-resilience and
          // observability are different properties (policy rule 4) -- log
          // even though a dead backend would otherwise just look like a
          // frozen UI.
          console.warn(`[chatfsm] pending-message poll failed: ${errorMessage(e)}`);
        });
    };
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [pendingCount, send, sessionId]);
}

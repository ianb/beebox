/**
 * Realtime + session-lifecycle effects for InteractiveChat: subscribes to the
 * global event stream over the shared WebSocket (schedule-fired, chat-history,
 * chat-complete,
 * chat-user-message, chat-features-changed, chat-session-assigned), syncs the
 * URL once a session id is assigned, and loads the voice config on mount.
 * Bundled into one hook so the component body isn't dominated by the event
 * dispatcher.
 */

import { useEffect, useCallback } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useBusSubscription, type RealtimeEvent } from "../../hooks/useBusSubscription";
import { getApiBase, type SessionEntry } from "../../api";
import { getTTSClient } from "../../lib/audio/tts-client";
import { alarm } from "../../lib/audio/earcons";
import { isTTSVoice } from "../../lib/audio/speech-parsing";
import { href, toSearch } from "../../lib/routing";
import { applyFeaturesChange } from "./InteractiveChat-helpers";
import { fulfillLastAudioRequest } from "../../lib/audio/last-audio";
import { bumpFileVersion } from "../../lib/file-version";
import type { CompiledSpeakingVoice } from "../../../../schemas/personality";
import type { ChatEvent } from "../../machines/chat-types";
import type { TaskEvent } from "./background-tasks";

// An agent (or anything) wrote a box file. Stamp a fresh cache-buster for that
// path so chat images at the same URL re-fetch instead of showing the
// browser's in-memory copy. See lib/file-version.ts.
function stampFileVersion(eventData: unknown): void {
  const data = eventData as { path?: string; timestamp?: string };
  if (data.path && data.timestamp) {
    bumpFileVersion(data.path, data.timestamp.replace(/\D/g, ""));
  }
}

/** True when an event tagged with `dataSessionId` belongs to this view's session. */
function forSession(dataSessionId: string | null, sessionId: string | null): boolean {
  return !(dataSessionId && sessionId && dataSessionId !== sessionId);
}

interface SecondaryEventDeps {
  sessionId: string | null;
  sessionInput: string;
  /** True when this tab has its own turn in flight — gates broadcast adoption. */
  isStreaming: boolean;
  send: (event: ChatEvent) => void;
  setChatFeatures: (features: Record<string, string>) => void;
  onTaskEvent: (task: TaskEvent) => void;
}

/**
 * Dispatch the lower-frequency / session-lifecycle events (background
 * tasks, file changes, feature toggles, session assignment). Split out of the
 * main dispatcher to keep each handler's branching legible.
 */
function handleSecondaryEvent(event: RealtimeEvent, deps: SecondaryEventDeps): void {
  const { sessionId, sessionInput, isStreaming, send, setChatFeatures, onTaskEvent } = deps;
  if (event.event === "chat-task") {
    const data = event.data as { sessionId: string | null; task: TaskEvent };
    if (forSession(data.sessionId, sessionId)) onTaskEvent(data.task);
  } else if (event.event === "file-change") {
    stampFileVersion(event.data);
  } else if (event.event === "chat-last-audio-request") {
    // The box agent ran `cb chat get-last-audio` — answer with this tab's
    // cached recording (or "none"; the server waits out other tabs).
    const data = event.data as { requestId: string };
    void fulfillLastAudioRequest(data.requestId);
  } else if (event.event === "chat-features-changed") {
    applyFeaturesChange({ data: event.data, currentSessionId: sessionId, setFeatures: setChatFeatures });
  } else if (event.event === "chat-session-assigned") {
    const data = event.data as { sessionId: string };
    // The authoritative, per-tab assignment is the in-stream `system/init`
    // delivered over this tab's own turnStream — it always corrects the id.
    // This bus broadcast is a backup (restart recovery), and it carries no
    // client correlation, so only adopt it when this tab actually has a turn in
    // flight. Otherwise a second, idle "new" tab would bind to another tab's
    // session. URL navigation is the useEffect below.
    if (sessionInput === "new" && !sessionId && isStreaming) {
      send({ type: "SESSION_ASSIGNED", sessionId: data.sessionId });
    }
  }
}

export function useChatWs(opts: {
  sessionId: string | null;
  sessionInput: string;
  boxSlug: string | undefined;
  currentUser: { email: string } | null | undefined;
  /** This tab has a turn streaming/refreshing — gates broadcast session adoption. */
  isStreaming: boolean;
  send: (event: ChatEvent) => void;
  fetchSchedules: () => void;
  setChatFeatures: (features: Record<string, string>) => void;
  onTaskEvent: (task: TaskEvent) => void;
}) {
  const { sessionId, sessionInput, boxSlug, currentUser, isStreaming, send, fetchSchedules, setChatFeatures, onTaskEvent } = opts;
  const navigate = useNavigate();
  const search = useSearch({ strict: false });

  // Subscribe to the box event stream over the shared WebSocket: schedule-fired,
  // chat-history, chat-complete, chat-user-message, chat-session-assigned.
  // Events tagged with a sessionId are filtered to this view's session only.
  useBusSubscription({
    onConnect: useCallback(() => {
      console.debug("[chatfsm] ws-connect");
      // Re-sync on every (re)connect: a full history REFRESH backs up the
      // subscription's automatic lastEventId replay for gaps that exceed the
      // event-bus retention window. REFRESH is ignored in streaming, so it's
      // safe to dispatch unconditionally.
      send({ type: "REFRESH" });
    }, [send]),
    onEvent: useCallback((event: RealtimeEvent) => {
      if (event.event === "schedule-fired") {
        const data = event.data as { label: string; alarm: boolean; announce: string | null };
        if (data.alarm) {
          alarm.play();
        }
        if (data.announce) {
          const tts = getTTSClient();
          tts.speak(data.announce).catch(() => {});
        }
        fetchSchedules();
      } else if (event.event === "chat-history") {
        const data = event.data as { entries: SessionEntry[]; sessionId: string | null };
        if (!forSession(data.sessionId, sessionId)) return;
        console.debug(`[chatfsm] ws-chat-history entries=${data.entries.length}`);
        send({ type: "SET_MESSAGES", messages: data.entries, sessionId: data.sessionId });
        fetchSchedules();
      } else if (event.event === "chat-complete") {
        const data = event.data as { sessionId: string | null };
        if (!forSession(data.sessionId, sessionId)) return;
        console.debug("[chatfsm] ws-chat-complete");
        // Agent turn completed — refresh history to pick up the response.
        send({ type: "REFRESH" });
      } else if (event.event === "chat-user-message") {
        const data = event.data as { sessionId: string | null; message: string; user: { email: string; name: string } | null; timestamp: string };
        if (!forSession(data.sessionId, sessionId)) return;
        if (data.user && currentUser && data.user.email !== currentUser.email) {
          send({
            type: "OTHER_USER_MESSAGE",
            message: data.message,
            userName: data.user.name,
            timestamp: data.timestamp,
          });
        }
      } else {
        handleSecondaryEvent(event, { sessionId, sessionInput, isStreaming, send, setChatFeatures, onTaskEvent });
      }
    }, [fetchSchedules, send, currentUser, sessionId, sessionInput, isStreaming, setChatFeatures, onTaskEvent]),
  });

  // Update the URL when the machine learns the assigned session id. Fires for
  // both signal paths — the in-stream `system/init` (first frame of every
  // turn, dispatched from chatMachine's streamActor) and the side-channel
  // `chat-session-assigned` event — so a backend restart that loses one
  // can't strand the chat on `?session=new`. `replace: true` so reload lands
  // on the right session.
  useEffect(() => {
    if (sessionInput !== "new") return;
    if (!sessionId) return;
    // Spread the previous search so a live `?card=` (and any other param)
    // survives the id assignment — a fresh `{ session }` object would drop it.
    // toSearch() is the sanctioned router-boundary escape hatch (see routing.ts).
    // navigate()'s promise only rejects on a superseded/redirected
    // navigation (not a user-facing failure) -- fire-and-forget.
    void navigate({
      to: href(`/${boxSlug}/chat`),
      search: toSearch({ ...search, session: sessionId }),
      replace: true,
    });
  }, [sessionInput, sessionId, navigate, boxSlug, search]);

  // Load voice config from personality on mount
  useEffect(() => {
    const tts = getTTSClient();
    fetch(`${getApiBase()}/chat/voice-config`)
      .then((r) => r.json() as Promise<CompiledSpeakingVoice>)
      .then((config) => {
        if (config.model && isTTSVoice(config.model)) {
          tts.setVoiceConfig({ voice: config.model });
        }
        if (config.instructions && config.instructions.length > 0) {
          tts.setVoiceConfig({ baseInstructions: config.instructions.join(" ") });
        }
      })
      .catch((e) => {
        console.warn("[chat] voice-config fetch failed; using defaults", e);
      })
      .finally(() => {
        tts.markConfigLoaded();
      });
  }, []);
}

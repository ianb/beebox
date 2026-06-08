/**
 * SSE + session-lifecycle effects for InteractiveChat: subscribes to the
 * global event stream (schedule-fired, chat-history, chat-complete,
 * chat-user-message, chat-features-changed, chat-session-assigned), syncs the
 * URL once a session id is assigned, and loads the voice config on mount.
 * Bundled into one hook so the component body isn't dominated by the event
 * dispatcher.
 */

import { useEffect, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSSE, type SSEEvent } from "../../hooks/useSSE";
import { getApiBase, getEventSourceBase, type SessionEntry } from "../../api";
import { getTTSClient } from "../../lib/tts-client";
import { alarm } from "../../lib/earcons";
import { isTTSVoice } from "../../lib/speech-parsing";
import { href } from "../../lib/routing";
import { applyFeaturesChange } from "./InteractiveChat-helpers";
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
  send: (event: ChatEvent) => void;
  setChatFeatures: (features: Record<string, string>) => void;
  onTaskEvent: (task: TaskEvent) => void;
}

/**
 * Dispatch the lower-frequency / session-lifecycle SSE events (background
 * tasks, file changes, feature toggles, session assignment). Split out of the
 * main dispatcher to keep each handler's branching legible.
 */
function handleSecondaryEvent(event: SSEEvent, deps: SecondaryEventDeps): void {
  const { sessionId, sessionInput, send, setChatFeatures, onTaskEvent } = deps;
  if (event.event === "chat-task") {
    const data = event.data as { sessionId: string | null; task: TaskEvent };
    if (forSession(data.sessionId, sessionId)) onTaskEvent(data.task);
  } else if (event.event === "file-change") {
    stampFileVersion(event.data);
  } else if (event.event === "chat-features-changed") {
    applyFeaturesChange({ data: event.data, currentSessionId: sessionId, setFeatures: setChatFeatures });
  } else if (event.event === "chat-session-assigned") {
    const data = event.data as { sessionId: string };
    // Lock the running machine onto the assigned id (so subsequent sends + the
    // post-stream refresh use it). URL navigation is handled by the useEffect
    // below, which also covers the faster in-stream `system/init` path.
    // ChatPage stabilizes the React key across this transition so the in-flight
    // stream survives.
    if (sessionInput === "new" && !sessionId) {
      send({ type: "SESSION_ASSIGNED", sessionId: data.sessionId });
    }
  }
}

export function useChatSse(opts: {
  sessionId: string | null;
  sessionInput: string;
  boxSlug: string | undefined;
  currentUser: { email: string } | null | undefined;
  /** A turn is streaming or refreshing — keep /events alive even if the tab
   *  is hidden so the completion event isn't missed. See keepAliveWhenHidden. */
  isStreaming: boolean;
  send: (event: ChatEvent) => void;
  fetchSchedules: () => void;
  setChatFeatures: (features: Record<string, string>) => void;
  onTaskEvent: (task: TaskEvent) => void;
}) {
  const { sessionId, sessionInput, boxSlug, currentUser, isStreaming, send, fetchSchedules, setChatFeatures, onTaskEvent } = opts;
  const navigate = useNavigate();

  // Handle SSE events: schedule-fired, chat-history, chat-user-message,
  // chat-session-assigned. Events tagged with a sessionId are filtered to
  // this view's session only.
  useSSE(`${getEventSourceBase()}/events`, {
    keepAliveWhenHidden: isStreaming,
    onConnect: useCallback(() => {
      console.debug("[chatfsm] sse-connect");
      // Re-sync after a (re)connect: any chat-complete / chat-history events
      // we missed while disconnected won't replay if the gap exceeded the
      // event-bus retention. REFRESH is a global handler that's ignored in
      // streaming, so it's safe to dispatch unconditionally.
      send({ type: "REFRESH" });
    }, [send]),
    onDisconnect: useCallback(() => {
      console.debug("[chatfsm] sse-disconnect");
    }, []),
    onEvent: useCallback((event: SSEEvent) => {
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
        console.debug(`[chatfsm] sse-chat-history entries=${data.entries.length}`);
        send({ type: "SET_MESSAGES", messages: data.entries, sessionId: data.sessionId });
        fetchSchedules();
      } else if (event.event === "chat-complete") {
        const data = event.data as { sessionId: string | null };
        if (!forSession(data.sessionId, sessionId)) return;
        console.debug("[chatfsm] sse-chat-complete");
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
        handleSecondaryEvent(event, { sessionId, sessionInput, send, setChatFeatures, onTaskEvent });
      }
    }, [fetchSchedules, send, currentUser, sessionId, sessionInput, setChatFeatures, onTaskEvent]),
  });

  // Update the URL when the machine learns the assigned session id. Fires for
  // both signal paths — the in-stream `system/init` (first frame of every
  // turn, dispatched from chatMachine's streamActor) and the side-channel
  // `chat-session-assigned` SSE event — so a backend restart that loses one
  // can't strand the chat on `?session=new`. `replace: true` so reload lands
  // on the right session.
  useEffect(() => {
    if (sessionInput !== "new") return;
    if (!sessionId) return;
    navigate({
      to: href(`/${boxSlug}/chat`),
      search: { session: sessionId } as never,
      replace: true,
    });
  }, [sessionInput, sessionId, navigate, boxSlug]);

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

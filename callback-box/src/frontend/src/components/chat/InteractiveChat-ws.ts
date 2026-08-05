/**
 * Realtime + session-lifecycle effects for InteractiveChat: subscribes to the
 * global event stream over the shared WebSocket (schedule-fired, chat-history,
 * chat-complete,
 * chat-user-message, chat-features-changed, chat-session-assigned), syncs the
 * URL once a session id is assigned, and loads the voice config on mount.
 * Bundled into one hook so the component body isn't dominated by the event
 * dispatcher.
 */

import { useEffect, useCallback, useRef } from "react";
import { z } from "zod";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useBusSubscription, type RealtimeEvent } from "../../hooks/useBusSubscription";
import { useDeferredResync } from "../../hooks/useDeferredResync";
import { busEventData } from "../../lib/bus-events";
import { createReconnectRefreshGate, type ReconnectRefreshGate } from "./reconnect-refresh-gate";
import { getApiBase } from "../../api";
import { getTTSClient } from "../../lib/audio/tts-client";
import { alarm } from "../../lib/audio/earcons";
import { isTTSVoice } from "../../lib/audio/speech-parsing";
import { href, toSearch } from "../../lib/routing";
import { applyFeaturesChange } from "./InteractiveChat-helpers";
import { fulfillLastAudioRequest } from "../../lib/audio/last-audio";
import { bumpFileVersion } from "../../lib/file-version";
import type { ChatEvent } from "../../machines/chat-types";
import type { TaskEvent } from "./background-tasks";
import type { CaptureLiveStatus } from "./capture-bubble";
import type { ScreenshotRequest } from "./screenshot-request-handler";

/**
 * Server response shape of GET /api/chat/voice-config (mirrors the backend's
 * `CompiledSpeakingVoiceSchema`; see routes/chat-audio-routes.ts). `model` is
 * kept a plain optional string here — the caller re-validates it through
 * `isTTSVoice` before use, so the frontend needn't import the backend voice enum.
 */
const voiceConfigSchema = z.object({
  model: z.string().optional(),
  instructions: z.array(z.string()),
});

// An agent (or anything) wrote a box file. Stamp a fresh cache-buster for that
// path so chat images at the same URL re-fetch instead of showing the
// browser's in-memory copy. See lib/file-version.ts.
function stampFileVersion(data: { path: string; timestamp: string }): void {
  bumpFileVersion(data.path, data.timestamp.replace(/\D/g, ""));
}

/**
 * How soon after mount a first subscription start still counts as "this mount
 * established it" (so its REFRESH is redundant with the mount's own bootstrap).
 * Later than this and the socket was down at mount: the start is a reconnect,
 * and the preloaded history is old enough to be worth re-reading.
 */
const PROMPT_SUBSCRIPTION_MS = 5000;

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
  /** A capture staging session changed state — refine the pending bubble. */
  onCaptureStatus: (data: { stagingId: string; status: CaptureLiveStatus }) => void;
  /** The agent asked this session's tab for a screenshot (`cb chat screenshot`). */
  onScreenshotRequest: (request: ScreenshotRequest) => void;
}

/**
 * Dispatch the lower-frequency / session-lifecycle events (background
 * tasks, file changes, feature toggles, session assignment). Split out of the
 * main dispatcher to keep each handler's branching legible.
 */
function handleSecondaryEvent(event: RealtimeEvent, deps: SecondaryEventDeps): void {
  const { sessionId, sessionInput, isStreaming, send, setChatFeatures, onTaskEvent, onCaptureStatus, onScreenshotRequest } = deps;
  const capture = busEventData(event, "capture-status");
  if (capture) {
    // `sessionId` on the event is null until delivery, so we don't filter by
    // session here — the bubble hook refetches its session-scoped query and
    // keys the live status by stagingId, ignoring ids not in this chat.
    onCaptureStatus({ stagingId: capture.stagingId, status: capture.status });
    return;
  }
  const task = busEventData(event, "chat-task");
  if (task) {
    if (forSession(task.sessionId, sessionId)) onTaskEvent(task.task);
    return;
  }
  const fileChange = busEventData(event, "file-change");
  if (fileChange) {
    stampFileVersion(fileChange);
    return;
  }
  const lastAudio = busEventData(event, "chat-last-audio-request");
  if (lastAudio) {
    // The box agent ran `cb chat get-last-audio` — answer with this tab's
    // cached recording (or "none"; the server waits out other tabs).
    void fulfillLastAudioRequest(lastAudio.requestId);
    return;
  }
  const screenshot = busEventData(event, "screenshot-request");
  if (screenshot) {
    // The box agent ran `cb chat screenshot`. The handler matches this view's
    // session EXACTLY (never `forSession`), acks, and runs the consent flow.
    onScreenshotRequest(screenshot);
    return;
  }
  const features = busEventData(event, "chat-features-changed");
  if (features) {
    applyFeaturesChange({ data: features, currentSessionId: sessionId, setFeatures: setChatFeatures });
    return;
  }
  const assigned = busEventData(event, "chat-session-assigned");
  if (assigned) {
    // The authoritative, per-tab assignment is the in-stream `system/init`
    // delivered over this tab's own turnStream — it always corrects the id.
    // This bus broadcast is a backup (restart recovery), and it carries no
    // client correlation, so only adopt it when this tab actually has a turn in
    // flight. Otherwise a second, idle "new" tab would bind to another tab's
    // session. URL navigation is the useEffect below.
    if (sessionInput === "new" && !sessionId && isStreaming) {
      send({ type: "SESSION_ASSIGNED", sessionId: assigned.sessionId });
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
  onCaptureStatus: (data: { stagingId: string; status: CaptureLiveStatus }) => void;
  onScreenshotRequest: (request: ScreenshotRequest) => void;
  /** Called immediately before assignment rewrites the fresh-chat URL. */
  onSessionAssignment?: (sessionId: string) => void;
}) {
  const { sessionId, sessionInput, boxSlug, currentUser, isStreaming, send, fetchSchedules, setChatFeatures, onTaskEvent, onCaptureStatus, onScreenshotRequest, onSessionAssignment } = opts;
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  // Rate-gates reconnect-driven REFRESHes: a connect within PROMPT_SUBSCRIPTION_MS
  // of the last one (or of mount, before the first) is redundant — either this
  // mount's own bootstrap just loaded history, or the socket is flapping and
  // already got a fresh REFRESH moments ago. Built once per mount (a session
  // switch remounts this hook, so its baseline is likewise a fresh mount);
  // `shouldRefresh()` re-evaluates on every later reconnect too, not just the
  // first — a flapping socket used to send one REFRESH per flap.
  const refreshGateRef = useRef<ReconnectRefreshGate | null>(null);
  useEffect(() => {
    const gate = createReconnectRefreshGate({ minIntervalMs: PROMPT_SUBSCRIPTION_MS, baselineAt: Date.now() });
    refreshGateRef.current = gate;
    // Cancel any pending trailing refresh timer on unmount — a session switch
    // remounts this hook, and a stale timer firing into a torn-down closure
    // would REFRESH the wrong (or a since-unmounted) session.
    return () => {
      gate.dispose();
      refreshGateRef.current = null;
    };
  }, []);

  // A reconnect-driven REFRESH is deferred while the tab is hidden — a
  // backgrounded tab shouldn't round-trip chat history until it's looked at
  // again — and fires once on becoming visible, no matter how many reconnects
  // (gate-eligible or not) accumulated in the meantime.
  const triggerRefresh = useDeferredResync(useCallback(() => {
    send({ type: "REFRESH" });
  }, [send]));

  // Subscribe to the box event stream over the shared WebSocket: schedule-fired,
  // chat-history, chat-complete, chat-user-message, chat-session-assigned.
  // Events tagged with a sessionId are filtered to this view's session only.
  useBusSubscription({
    onConnect: useCallback(() => {
      console.debug("[chatfsm] ws-connect");
      // Re-sync on every RE-connect: a full history REFRESH backs up the
      // subscription's automatic lastEventId replay for gaps that exceed the
      // event-bus retention window. REFRESH is ignored in streaming, so it's
      // safe to dispatch unconditionally (once the gate clears it). A
      // reconnect inside the gate's window isn't dropped — the gate arms a
      // trailing timer so it's still eventually serviced.
      refreshGateRef.current?.notifyReconnect(triggerRefresh);
    }, [triggerRefresh]),
    onEvent: useCallback((event: RealtimeEvent) => {
      const scheduleFired = busEventData(event, "schedule-fired");
      const history = busEventData(event, "chat-history");
      const complete = busEventData(event, "chat-complete");
      const userMessage = busEventData(event, "chat-user-message");
      if (scheduleFired) {
        if (scheduleFired.alarm) {
          alarm.play();
        }
        if (scheduleFired.announce) {
          const tts = getTTSClient();
          tts.speak(scheduleFired.announce).catch(() => {});
        }
        fetchSchedules();
      } else if (history) {
        if (!forSession(history.sessionId, sessionId)) return;
        console.debug(`[chatfsm] ws-chat-history entries=${history.entries.length}`);
        send({ type: "SET_MESSAGES", messages: history.entries, sessionId: history.sessionId });
        fetchSchedules();
      } else if (complete) {
        if (!forSession(complete.sessionId, sessionId)) return;
        console.debug("[chatfsm] ws-chat-complete");
        // Agent turn completed — refresh history to pick up the response.
        send({ type: "REFRESH" });
      } else if (userMessage) {
        if (!forSession(userMessage.sessionId, sessionId)) return;
        if (userMessage.user === null) {
          // SERVER-INJECTED message — a delivered `<upload>` batch or `<capture>`
          // (`core/chat/session/deliver-user-message.ts` emits `user: null`).
          // Nothing in this client initiated it, so without a refresh the message
          // and the agent turn it starts are both invisible until a manual
          // reload — which is exactly what a boxholder hit after a bulk upload
          // (2026-08-01): photos landed, the agent replied, and the chat showed
          // neither until they reloaded the page.
          //
          // REFRESH is ignored while streaming, so this can't disturb a turn this
          // client is already following.
          send({ type: "REFRESH" });
        } else if (currentUser && userMessage.user.email !== currentUser.email) {
          send({
            type: "OTHER_USER_MESSAGE",
            message: userMessage.message,
            userName: userMessage.user.name,
            timestamp: userMessage.timestamp,
          });
        }
      } else {
        handleSecondaryEvent(event, { sessionId, sessionInput, isStreaming, send, setChatFeatures, onTaskEvent, onCaptureStatus, onScreenshotRequest });
      }
    }, [fetchSchedules, send, currentUser, sessionId, sessionInput, isStreaming, setChatFeatures, onTaskEvent, onCaptureStatus, onScreenshotRequest]),
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
    onSessionAssignment?.(sessionId);
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
  }, [sessionInput, sessionId, navigate, boxSlug, search, onSessionAssignment]);

  // Load voice config from personality on mount
  useEffect(() => {
    const tts = getTTSClient();
    fetch(`${getApiBase()}/chat/voice-config`)
      .then((r) => r.json())
      .then((raw) => {
        const parsed = voiceConfigSchema.safeParse(raw);
        if (!parsed.success) {
          console.warn("[chat] voice-config response malformed; using defaults", parsed.error.message);
          return;
        }
        const config = parsed.data;
        if (config.model && isTTSVoice(config.model)) {
          tts.setVoiceConfig({ voice: config.model });
        }
        if (config.instructions.length > 0) {
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

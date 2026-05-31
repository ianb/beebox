/**
 * InteractiveChat - the live chat UI for the box's conversational assistant.
 *
 * Streams messages from the backend ChatSession via SSE.
 * User input is wrapped in <typed> tags before sending.
 * User messages are right-aligned dark bubbles; assistant uses markdown.
 *
 * Receives `sessionInput` from ChatPage — either an existing session id or
 * the `"new"` sentinel for a fresh conversation. Keyed on that prop so
 * a session switch (or new-chat reset) cleanly remounts the machine.
 */

import { useState, useRef, useCallback, useMemo } from "react";
// search params read via window.location — avoids coupling to route definition
import { useSSRMachine } from "../../hooks/useSSRMachine";
import { chatMachine } from "../../machines/chatMachine.js";
import { groupMessages } from "../ChatMessages";
import { serializeViewUrl } from "../../lib/view-url";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useParams } from "@tanstack/react-router";
import { trpc } from "../../lib/trpc";
import { newMessageId, formatTimePassed } from "./InteractiveChat-helpers";
import { useChatModelFeatures, useChatMute, useChatSchedules, usePendingMessagePoll, useChatTabs } from "./InteractiveChat-hooks";
import { useChatAttachments } from "./InteractiveChat-attachments";
import { useChatVoice } from "./InteractiveChat-voice";
import { useChatSse } from "./InteractiveChat-sse";
import { useChatActions } from "./InteractiveChat-actions";
import { InteractiveChatBody } from "./InteractiveChat-view";

/**
 * Resolve the directory a chat is bound to. Returns the prop value
 * immediately for fresh "new" landmark chats (server hasn't seen the
 * session id yet) and falls back to the persisted association for
 * resumed sessions.
 */
function useEffectiveContextDir(params: {
  sessionId: string | null;
  contextDir: string | undefined;
}): string | null {
  const query = trpc.chat.directoryFor.useQuery(
    { sessionId: params.sessionId ?? "" },
    { enabled: Boolean(params.sessionId) },
  );
  return params.contextDir ?? query.data?.contextDir ?? null;
}

interface InteractiveChatProps {
  /** Either an existing session id or `"new"` for a fresh conversation. */
  sessionInput: string;
  /**
   * If set on a `"new"` chat, the chat is bound to this landmark directory.
   * Sent to the backend on the first send; the SDK spawns with `cwd` set
   * there and the association is persisted to chat-session-history. Once
   * the session id is assigned, future resumes look it up server-side.
   */
  contextDir?: string;
}

export function InteractiveChat({ sessionInput, contextDir }: InteractiveChatProps) {
  const [snapshot, send] = useSSRMachine(chatMachine, {
    input: { sessionInput, contextDir },
  });
  const { messages, pendingMessages, streamText, streamTools, error, sessionId, processRunning, processBusy, totalEntries } = snapshot.context;
  const effectiveContextDir = useEffectiveContextDir({ sessionId, contextDir });
  const isStreaming = snapshot.matches("streaming") || snapshot.matches("refreshing");
  const isLoading = snapshot.matches("loading");
  const currentUser = useCurrentUser();
  const { boxSlug } = useParams({ strict: false });

  const [input, setInput] = useState("");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [scrollToBottomTrigger, setScrollToBottomTrigger] = useState(0);
  const [debugView, setDebugView] = useState(false);
  const [showDebugLog, setShowDebugLog] = useState(false);
  const [typingMode, setTypingMode] = useState(false);
  const [typingLocked, setTypingLocked] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const groups = useMemo(() => groupMessages(messages), [messages]);

  const model = useChatModelFeatures({ sessionId, groupCount: groups.length });
  const mute = useChatMute();
  const tabs = useChatTabs();
  const { activeView } = tabs;
  const schedules = useChatSchedules({ messages, isStreaming, send });
  usePendingMessagePoll({ pendingCount: pendingMessages.length, sessionId, send });

  const doSend = useCallback(
    (wrapped: string) => {
      send({ type: "SEND", message: wrapped, messageId: newMessageId() });
    },
    [send]
  );

  const zoomedViewAttr = useCallback(() => {
    if (!activeView) return "";
    const uri = `view:${serializeViewUrl(activeView.target)}`;
    return ` zoomed-view="${uri}"`;
  }, [activeView]);

  const timePassedAttr = useCallback(() => {
    if (messages.length === 0) return "";
    const last = messages[messages.length - 1];
    const elapsed = Date.now() - new Date(last.timestamp).getTime();
    const formatted = formatTimePassed(elapsed);
    return formatted ? ` time-passed="${formatted}"` : "";
  }, [messages]);

  const voice = useChatVoice({
    snapshot, sessionId, muted: mute.muted, narrationEnabled: model.narrationEnabled,
    setInput, doSend, zoomedViewAttr, timePassedAttr,
  });
  const attach = useChatAttachments({ input, setInput, textareaRef });

  useChatSse({
    sessionId, sessionInput, boxSlug, currentUser, send,
    fetchSchedules: schedules.fetchSchedules, setChatFeatures: model.setChatFeatures,
  });

  const actions = useChatActions({
    send, sessionId, boxSlug, effectiveContextDir, messages, totalEntries, loadingOlder, setLoadingOlder,
    input, setInput, attachments: attach.attachments, fileAttachments: attach.fileAttachments,
    resetAttachments: attach.resetAttachments, addImageFiles: attach.addImageFiles,
    turnTakingRef: voice.turnTakingRef, isTranscribing: voice.isTranscribing, textareaRef,
    transcriptTick: voice.transcription.transcript, typingMode, typingLocked, setTypingMode,
    setScrollToBottomTrigger, zoomedViewAttr, timePassedAttr,
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-warm-500">
        Loading chat...
      </div>
    );
  }

  return (
    <InteractiveChatBody
      tabs={tabs}
      model={model}
      mute={mute}
      voice={voice}
      attach={attach}
      actions={actions}
      schedules={schedules}
      effectiveContextDir={effectiveContextDir}
      boxSlug={boxSlug}
      messages={messages}
      groups={groups}
      isStreaming={isStreaming}
      streamText={streamText}
      streamTools={streamTools}
      processBusy={Boolean(processBusy)}
      processRunning={processRunning}
      sessionId={sessionId}
      totalEntries={totalEntries}
      pendingCount={pendingMessages.length}
      error={error}
      currentUserEmail={currentUser?.email}
      modelMarkers={model.modelMarkers}
      loadingOlder={loadingOlder}
      scrollToBottomTrigger={scrollToBottomTrigger}
      snapshot={snapshot}
      input={input}
      setInput={setInput}
      textareaRef={textareaRef}
      debugView={debugView}
      setDebugView={setDebugView}
      showDebugLog={showDebugLog}
      setShowDebugLog={setShowDebugLog}
      typingMode={typingMode}
      setTypingMode={setTypingMode}
      typingLocked={typingLocked}
      setTypingLocked={setTypingLocked}
      doSend={doSend}
      send={send}
      zoomedViewAttr={zoomedViewAttr}
      timePassedAttr={timePassedAttr}
    />
  );
}

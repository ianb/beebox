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

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
// search params read via window.location — avoids coupling to route definition
import { useSSRMachine } from "../../hooks/useSSRMachine";
import { chatMachine } from "../../machines/chatMachine.js";
import { groupMessages } from "../ChatMessages";
import { serializeViewUrl } from "../../lib/view-url";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useParams } from "@tanstack/react-router";
import { trpc } from "../../lib/trpc";
import { newMessageId, formatTimePassed, localTime, buildSpeechMessage } from "./InteractiveChat-helpers";
import { useDictationDraft } from "../../hooks/useDictationDraft";
import { useComposerDraft } from "../../hooks/useComposerDraft";
import { RecoveredDictation } from "./RecoveredDictation";
import { useChatModelFeatures, useChatMute, useChatSchedules, usePendingMessagePoll, useProcessingStatusPoll, useChatStallRecovery, useChatTabs } from "./InteractiveChat-hooks";
import { useChatAttachments } from "./InteractiveChat-attachments";
import { useChatSelections } from "./InteractiveChat-selections";
import { useChatVoice } from "./InteractiveChat-voice";
import { useChatSse } from "./InteractiveChat-sse";
import { useChatActions } from "./InteractiveChat-actions";
import { useBackgroundTasks } from "./BackgroundTasks";
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
  const queried = query.data ? query.data.contextDir : undefined;
  return params.contextDir ?? queried ?? null;
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
  const backgroundTasks = useBackgroundTasks();

  const [input, setInput] = useState("");
  // Persist the unsent composer text so a remount (e.g. the router re-reading
  // search params on wake-from-sleep) or a reload doesn't silently discard it.
  useComposerDraft({ boxSlug, sessionId, input, setInput });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [scrollToBottomTrigger, setScrollToBottomTrigger] = useState(0);
  const [debugView, setDebugView] = useState(false);
  const [showDebugLog, setShowDebugLog] = useState(false);
  const [typingMode, setTypingMode] = useState(false);
  const [typingLocked, setTypingLocked] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const groups = useMemo(() => groupMessages(messages), [messages]);

  const model = useChatModelFeatures({ sessionId, groupCount: groups.length, send });
  const mute = useChatMute();
  const tabs = useChatTabs();
  const { activeView } = tabs;
  const schedules = useChatSchedules({ messages, isStreaming, send });
  usePendingMessagePoll({ pendingCount: pendingMessages.length, sessionId, send });
  useProcessingStatusPoll({ processBusy: Boolean(processBusy), isStreaming, sessionId, send });
  useChatStallRecovery({ isStreamingState: snapshot.matches("streaming"), sessionId, send });

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

  const attach = useChatAttachments({ input, setInput, textareaRef });
  const selections = useChatSelections({ input, setInput, textareaRef });
  // Set after the draft hook below; threaded into voice so a committed segment
  // drops the persisted draft. A ref breaks the voice→draft→voice cycle.
  const clearDraftRef = useRef<() => void>(() => {});
  const voice = useChatVoice({
    snapshot, sessionId, muted: mute.muted, narrationEnabled: model.narrationEnabled,
    selections: selections.selections, resetSelections: selections.resetSelections,
    clearDraftRef, input, setInput, doSend, zoomedViewAttr, timePassedAttr,
  });

  // Persist the in-flight transcript so an interrupted session (screen sleep,
  // tab eviction, reload) doesn't erase it. Recovery surfaces in a dedicated
  // widget above the composer rather than autofilling the field.
  const { recoveredDraft, clearDraft } = useDictationDraft({
    boxSlug, sessionId,
    transcript: voice.transcription.transcript,
    isTranscribing: voice.isTranscribing,
    narrationEnabled: model.narrationEnabled,
  });
  useEffect(() => { clearDraftRef.current = clearDraft; });

  const handleRecoverSend = useCallback(() => {
    if (!recoveredDraft) return;
    // No audio survives a drop, so the realtime text stands in for the HQ pass
    // (the design's documented HQ-failure fallback). Sent as a narration
    // <speech> message; the session's narration flag re-syncs from the server.
    const attrs = ` local-time="${localTime()}"${zoomedViewAttr()}${timePassedAttr()}`;
    doSend(buildSpeechMessage({ text: recoveredDraft.text, diarized: false, selections: [], attrs }));
    clearDraft();
  }, [recoveredDraft, zoomedViewAttr, timePassedAttr, doSend, clearDraft]);

  // Surface the recovery widget only when idle: hidden while the mic is open
  // and while an HQ commit is in flight (the mic briefly idles between
  // segments — don't flash the just-committed text as "recovered").
  const recoveredDictation = recoveredDraft && !voice.isTranscribing && !voice.hqInFlight ? (
    <RecoveredDictation
      draft={recoveredDraft}
      sessionId={sessionId}
      onSend={handleRecoverSend}
      onDiscard={clearDraft}
    />
  ) : null;

  useChatSse({
    sessionId, sessionInput, boxSlug, currentUser, isStreaming, send,
    fetchSchedules: schedules.fetchSchedules, setChatFeatures: model.setChatFeatures,
    onTaskEvent: backgroundTasks.onTaskEvent,
  });

  const actions = useChatActions({
    send, sessionId, boxSlug, effectiveContextDir, messages, totalEntries, loadingOlder, setLoadingOlder,
    input, setInput, attachments: attach.attachments, fileAttachments: attach.fileAttachments,
    selections: selections.selections,
    resetAttachments: attach.resetAttachments, resetSelections: selections.resetSelections,
    addImageFiles: attach.addImageFiles,
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
      recoveredDictation={recoveredDictation}
      attach={attach}
      selections={selections}
      actions={actions}
      schedules={schedules}
      effectiveContextDir={effectiveContextDir}
      boxSlug={boxSlug}
      messages={messages}
      groups={groups}
      backgroundTasks={backgroundTasks.tasks}
      isStreaming={isStreaming}
      streamText={streamText}
      streamTools={streamTools}
      processBusy={Boolean(processBusy)}
      processRunning={processRunning}
      sessionId={sessionId}
      totalEntries={totalEntries}
      pendingCount={pendingMessages.length}
      error={error}
      currentUserEmail={currentUser ? currentUser.email : undefined}
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

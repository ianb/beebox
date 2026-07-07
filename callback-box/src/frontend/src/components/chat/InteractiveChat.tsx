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
import { groupMessages } from "./ChatMessages";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useParams } from "@tanstack/react-router";
import { trpc } from "../../lib/trpc";
import { useEmissionDispatch } from "./InteractiveChat-dispatch";
import { useDictationDraft } from "../../hooks/useDictationDraft";
import { useEmissionPersistence } from "../../hooks/useEmissionPersistence";
import { RecoveredDictation } from "./RecoveredDictation";
import { ExpiredAttachmentsNotice } from "./InteractiveChat-layout";
import { useChatModelFeatures, useChatMute, useChatSchedules, usePendingMessagePoll, useProcessingStatusPoll, useChatStallRecovery, useChatTabs, useCompanionDeepLink } from "./InteractiveChat-hooks";
import { useCompanionCard } from "./InteractiveChat-card-hooks";
import { useChatAttachments } from "./InteractiveChat-attachments";
import { useChatSelections } from "./InteractiveChat-selections";
import { useChatVoice } from "./InteractiveChat-voice";
import { useChatWs } from "./InteractiveChat-ws";
import { useChatActions } from "./InteractiveChat-actions";
import { useBackgroundTasks } from "./BackgroundTasks";
import { InteractiveChatBody } from "./InteractiveChat-view";
import { createInputStoreAdapter, InputStoreProvider } from "./input-store";
import type { EmissionStore } from "../../input/emission-store";
import type { Emission } from "../../input/emission";
import { nativeEmissionFromDetail } from "./native-emission";

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
  /**
   * A `view:` URL to open in the companion pane once, on mount — set by
   * deep-links such as the clerk extension's "comment on this page" flow.
   */
  companion?: string;
  /**
   * The card live-open in the companion pane, persisted in `?card=` (a
   * serialized view URL, no `view:` prefix). Restored on mount and kept in
   * sync as the active card changes. Distinct from `companion` (one-shot).
   */
  card?: string;
  /**
   * The lifted emission store: created once in `ChatPage`, above this
   * component's `key={keyState.epoch}` remount boundary, so the in-progress
   * composition survives a session switch (docs/implemented-plans/input-extraction.md,
   * chunk 4).
   */
  emissionStore: EmissionStore;
  /**
   * Conversation-only mode for native shells. The page remains a full chat
   * event client, but the web composer and mic controls are suppressed.
   */
  embedded?: boolean;
}

export function InteractiveChat({ sessionInput, contextDir, companion, card, emissionStore, embedded }: InteractiveChatProps) {
  const isEmbedded = embedded === true;
  const [snapshot, send] = useSSRMachine(chatMachine, {
    input: { sessionInput, contextDir },
  });
  const { messages, pendingMessages, streamText, streamTools, error, sessionId, processRunning, processBusy, totalEntries, liveTurnId } = snapshot.context;
  const effectiveContextDir = useEffectiveContextDir({ sessionId, contextDir });
  const isStreaming = snapshot.matches("streaming") || snapshot.matches("refreshing");
  const isLoading = snapshot.matches("loading");
  const currentUser = useCurrentUser();
  const { boxSlug } = useParams({ strict: false });
  const backgroundTasks = useBackgroundTasks();

  // Composer text lives in an external store, not React state, so a keystroke
  // re-renders only the composer textareas — not the message history or the
  // companion view pane (see input-store.ts and components/chat/CLAUDE.md).
  // The full emission store is a prop (see above); this derives the
  // text-only view every render — cheap, and stable in identity as long as
  // `emissionStore` is (it always is, across a session switch).
  const inputStore = useMemo(() => createInputStoreAdapter(emissionStore), [emissionStore]);
  // Persist the whole in-progress emission (text, images, files, selections)
  // under one singleton key per box, so it survives a session switch AND a
  // reload — the design's singleton-draft promise.
  const { expiredAttachments, dismissExpiredAttachments } = useEmissionPersistence({ boxSlug, emissionStore });
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
  useCompanionDeepLink({ companion, onZoomView: tabs.onZoomView, boxSlug });
  const cardSend = useCompanionCard({ initialCard: card, activeView, onZoomView: tabs.onZoomView, boxSlug, error });
  const schedules = useChatSchedules({ messages, isStreaming, send });
  usePendingMessagePoll({ pendingCount: pendingMessages.length, sessionId, send });
  useProcessingStatusPoll({ processBusy: Boolean(processBusy), isStreaming, sessionId, send });
  useChatStallRecovery({ isStreamingState: snapshot.matches("streaming"), sessionId, send });

  // The one user-send funnel: every send site builds an Emission and lands
  // in dispatchEmission (docs/implemented-plans/input-extraction.md chunk 1); assembly
  // and witness capture live in InteractiveChat-dispatch.ts.
  const attach = useChatAttachments({ emissionStore, textareaRef });
  const selections = useChatSelections({ emissionStore, textareaRef });
  const { dispatchEmission, sendVoiceSegment, sendStopSend } = useEmissionDispatch({
    send, captureCardSend: cardSend.capture, boxSlug, activeView, messages, emissionStore,
    selections: selections.selections, resetSelections: selections.resetSelections,
  });
  // useChatVoice/useChatActions only ever fire-and-forget dispatchEmission
  // (its Promise<Receipt> is for callers that want to await the outcome,
  // per InteractiveChat-dispatch.ts) -- void it once here so both callees'
  // option types can stay honestly void-returning.
  const dispatchEmissionVoid = useCallback(
    (emission: Emission) => { void dispatchEmission(emission); },
    [dispatchEmission]
  );
  useNativeEmissionBridge({ enabled: isEmbedded, dispatchEmission: dispatchEmissionVoid });
  // Set after the draft hook below; threaded into voice so a committed segment
  // drops the persisted draft. A ref breaks the voice→draft→voice cycle.
  const clearDraftRef = useRef<() => void>(() => {});
  const voice = useChatVoice({
    snapshot, sessionId, muted: mute.muted, narrationEnabled: model.narrationEnabled,
    selections: selections.selections, resetSelections: selections.resetSelections,
    clearDraftRef, inputStore, dispatchEmission: dispatchEmissionVoid,
  });

  // Persist the in-flight transcript so an interrupted session (screen sleep,
  // tab eviction, reload) doesn't erase it. Recovery surfaces in a dedicated
  // widget above the composer rather than autofilling the field.
  const { recoveredDraft, clearDraft } = useDictationDraft({
    boxSlug,
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
    sendVoiceSegment(recoveredDraft.text);
    clearDraft();
  }, [recoveredDraft, sendVoiceSegment, clearDraft]);

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

  const expiredAttachmentsNotice = (
    <ExpiredAttachmentsNotice names={expiredAttachments} onDismiss={dismissExpiredAttachments} />
  );

  useChatWs({
    sessionId, sessionInput, boxSlug, currentUser, isStreaming, send,
    fetchSchedules: schedules.fetchSchedules, setChatFeatures: model.setChatFeatures,
    onTaskEvent: backgroundTasks.onTaskEvent,
  });

  const actions = useChatActions({
    send, sessionId, boxSlug, effectiveContextDir, messages, totalEntries, loadingOlder, setLoadingOlder,
    inputStore, attachments: attach.attachments, fileAttachments: attach.fileAttachments,
    selections: selections.selections,
    resetAttachments: attach.resetAttachments, resetSelections: selections.resetSelections,
    // Both addImageFiles and dispatchEmission already catch their own
    // errors internally; voided here so useChatActions' option types can
    // stay honestly void-returning.
    addImageFiles: (files) => { void attach.addImageFiles(files); },
    onSend: voice.notifySent, isTranscribing: voice.isTranscribing, textareaRef,
    transcriptTick: voice.transcription.transcript, typingMode, typingLocked, setTypingMode,
    setScrollToBottomTrigger, dispatchEmission: dispatchEmissionVoid,
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-warm-500">
        Loading chat...
      </div>
    );
  }

  return (
    <InputStoreProvider value={inputStore}>
      <InteractiveChatBody
      tabs={tabs}
      model={model}
      mute={mute}
      voice={voice}
      recoveredDictation={recoveredDictation}
      expiredAttachmentsNotice={expiredAttachmentsNotice}
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
      scrollToBottomTrigger={scrollToBottomTrigger} liveTurnId={liveTurnId}
      snapshot={snapshot}
      textareaRef={textareaRef}
      debugView={debugView}
      setDebugView={setDebugView}
      showDebugLog={showDebugLog}
      setShowDebugLog={setShowDebugLog}
      typingMode={typingMode}
      setTypingMode={setTypingMode}
      typingLocked={typingLocked}
      setTypingLocked={setTypingLocked}
      onVoiceSegmentSend={sendStopSend}
      send={send}
      reportCardActivity={cardSend.report}
      embedded={isEmbedded}
      />
    </InputStoreProvider>
  );
}

function useNativeEmissionBridge(opts: { enabled: boolean; dispatchEmission: (emission: Emission) => void }) {
  const { enabled, dispatchEmission } = opts;
  useEffect(() => {
    if (!enabled) return;
    for (const detail of drainNativeEmissionQueue()) {
      const emission = nativeEmissionFromDetail(detail);
      if (emission) dispatchEmission(emission);
    }
    const listener = () => {
      for (const detail of drainNativeEmissionQueue()) {
        const emission = nativeEmissionFromDetail(detail);
        if (emission) dispatchEmission(emission);
      }
    };
    window.addEventListener("callbackbox:native-emission", listener);
    return () => window.removeEventListener("callbackbox:native-emission", listener);
  }, [enabled, dispatchEmission]);
}

function drainNativeEmissionQueue(): unknown[] {
  const nativeWindow = window as Window & { callbackboxNativeQueue?: unknown[] };
  const queued = nativeWindow.callbackboxNativeQueue ?? [];
  nativeWindow.callbackboxNativeQueue = [];
  return queued;
}

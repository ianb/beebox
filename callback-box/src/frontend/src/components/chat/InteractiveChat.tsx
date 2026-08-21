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
import { createAudioOverlayStore } from "./audio-overlay-store";
// search params read via window.location — avoids coupling to route definition
import { useMachine } from "@xstate/react";
import { chatMachine } from "../../machines/chatMachine.js";
import type { ChatInitialLoad } from "../../machines/chat-types";
import { groupMessages } from "./ChatMessages";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useParams } from "@tanstack/react-router";
import { trpc } from "../../lib/trpc";
import { useEmissionDispatch } from "./InteractiveChat-dispatch";
import { useEmissionPersistence } from "../../hooks/useEmissionPersistence";
import { useRecoveredDictation } from "./InteractiveChat-recovery";
import { ChatLoading, ExpiredAttachmentsNotice } from "./InteractiveChat-layout";
import { useChatModelFeatures, useChatMute, useChatSchedules, usePendingMessagePoll, useChatStallRecovery, useChatTabs, useCompanionDeepLink } from "./InteractiveChat-hooks";
import { useProcessingStatusPoll } from "./processing-status-display";
import { useCompanionCard } from "./InteractiveChat-card-hooks";
import { useChatAttachments, useEnsureComposerVisible } from "./InteractiveChat-attachments";
import { useBulkUploadLaunch, type BulkUploadLaunch } from "./use-bulk-upload-launch";
import { useChatSelections } from "./InteractiveChat-selections";
import { useChatVoice } from "./InteractiveChat-voice";
import { useChatWs } from "./InteractiveChat-ws";
import { useChatActions } from "./InteractiveChat-actions";
import { useBackgroundTasks } from "./BackgroundTasks";
import { InteractiveChatBody } from "./InteractiveChat-view";
import { createInputStoreAdapter, InputStoreProvider } from "./input-store";
import type { EmissionStore } from "../../input/emission-store";
import type { Emission } from "../../input/emission";
import { useCaptureBubbles } from "./useCaptureBubbles";
import { CaptureOverlay } from "../capture/CaptureOverlay";
import { BulkUploadOverlay } from "../bulk-upload/BulkUploadOverlay";
import { useScreenshotRequests } from "./screenshot-request-handler";
import { useNativeBridges } from "./use-native-bridge";

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
  /** Preserve web chrome while suppressing input for a native shell. */
  nativeComposer?: boolean;
  /**
   * Open capture mode immediately on mount — the `/capture` deep link
   * (`?capture=1`) redirects here. Consumed once via initial state; the mode is
   * a normal user toggle afterward.
   */
  openCaptureOnMount?: boolean;
  /**
   * History + status for `sessionInput`, already fetched by ChatPage's
   * `chat.bootstrap` call. Consumed once by the machine's `loading` state
   * instead of a second round trip. Omitted for a `"new"` chat (nothing to
   * load) and when the caller has no preload.
   */
  initial?: ChatInitialLoad;
  /**
   * The session's display name, from the same `chat.bootstrap` call — the app
   * bar's session chip face (docs/plans/top-nav-ia.md Track C2). Null for a
   * fresh chat (and until bootstrap settles); the chip then reads "New chat".
   */
  sessionLabel: string | null;
  /** Announce a backend-assigned id before the fresh-chat URL is rewritten. */
  onSessionAssignment?: (sessionId: string) => void;
}

/**
 * The two full-screen composer overlays (capture, bulk upload), grouped so the
 * InteractiveChat body carries one line rather than their gating. Both are
 * suppressed for native shells; bulk additionally requires a server-assigned
 * session id (its batch binds to a target chat).
 */
function ChatModeOverlays({ captureMode, bulkUpload, usesNativeShell, sessionId, onExitCapture, onExitBulkUpload, onBulkUploadDelivered }: {
  captureMode: boolean;
  bulkUpload: BulkUploadLaunch | null;
  usesNativeShell: boolean;
  sessionId: string | null;
  onExitCapture: () => void;
  onExitBulkUpload: () => void;
  onBulkUploadDelivered: () => void;
}) {
  return (
    <>
      {captureMode && !usesNativeShell ? <CaptureOverlay targetSessionId={sessionId} onExit={onExitCapture} /> : null}
      {bulkUpload !== null && !usesNativeShell && sessionId !== null ? (
        <BulkUploadOverlay
          targetSessionId={sessionId}
          seedFiles={bulkUpload.seedFiles}
          note={bulkUpload.note}
          onExit={onExitBulkUpload}
          onDelivered={onBulkUploadDelivered}
        />
      ) : null}
    </>
  );
}

export function InteractiveChat({ sessionInput, contextDir, companion, card, emissionStore, embedded, nativeComposer, openCaptureOnMount, initial, sessionLabel, onSessionAssignment }: InteractiveChatProps) {
  const usesNativeComposer = nativeComposer === true; const usesNativeShell = embedded === true || usesNativeComposer;
  const [snapshot, send] = useMachine(chatMachine, {
    input: { sessionInput, contextDir, initial },
  });
  const { messages, pendingMessages, streamText, streamTools, error, sessionId, processRunning, processBusy, totalEntries, liveTurnId } = snapshot.context;
  const effectiveContextDir = useEffectiveContextDir({ sessionId, contextDir });
  const isStreaming = snapshot.matches("streaming") || snapshot.matches("refreshing"); const isLoading = snapshot.matches("loading");
  const currentUser = useCurrentUser();
  const { boxSlug } = useParams({ strict: false });
  const backgroundTasks = useBackgroundTasks(); const audioOverlayStore = useMemo(() => createAudioOverlayStore(), []); // see audio-overlay-store.ts

  // Composer text lives outside React state, so keystrokes re-render only its textareas.
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
  // Capture mode: a rare user toggle (frame state, not URL / per-keystroke), so
  // it lives in root state; the overlay's recording-timer ticks stay in its own
  // subtree. Seeded from the `?capture=1` deep link, consumed once.
  const [captureMode, setCaptureMode] = useState(openCaptureOnMount === true);
  // Server-derived pending capture bubbles (survive reload; refined live below).
  const { bubbles: captureBubbleList, applyCaptureStatus, retry: handleCaptureRetry } = useCaptureBubbles(sessionId);
  const screenshots = useScreenshotRequests(sessionId);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const groups = useMemo(() => groupMessages(messages), [messages]);

  const model = useChatModelFeatures({ sessionId, groupCount: groups.length, send });
  const mute = useChatMute();
  const tabs = useChatTabs();
  const { activeView } = tabs;
  useCompanionDeepLink({ companion, onZoomView: tabs.onZoomView, boxSlug });
  const cardSend = useCompanionCard({ initialCard: card, activeView, onZoomView: tabs.onZoomView, boxSlug, error });
  const schedules = useChatSchedules({ messages, loaded: !isLoading, isStreaming, send });
  usePendingMessagePoll({ pendingCount: pendingMessages.filter((entry) => entry.pending === true).length, sessionId, send });
  const showAgentWorking = useProcessingStatusPoll({ processBusy: Boolean(processBusy), isStreaming, isStreamingState: snapshot.matches("streaming"), sessionId, send });
  useChatStallRecovery({ isStreamingState: snapshot.matches("streaming"), sessionId, send });

  // The one user-send funnel: every send site builds an Emission and lands
  // in dispatchEmission (docs/implemented-plans/input-extraction.md chunk 1); assembly
  // and witness capture live in InteractiveChat-dispatch.ts.
  // Assigned by useEnsureComposerVisible below (it needs voice state) — the
  // same ref pattern as clearDraftRef.
  const ensureComposerVisibleRef = useRef<() => void>(() => {});
  // Set by the draft hook further down; threaded into voice so a committed
  // segment drops the persisted draft, and into the bulk-upload launcher so a
  // delivered batch drops the text it carried away. A ref breaks the
  // voice→draft→voice cycle.
  const clearDraftRef = useRef<() => void>(() => {});
  const { launch: bulkUploadLaunch, openEmpty: handleOpenBulkUpload, openWithPhotos: handleBatchPhotos, close: handleCloseBulkUpload, onDelivered: handleBulkUploadDelivered } = useBulkUploadLaunch({ emissionStore, clearDraftRef });
  const attach = useChatAttachments({ emissionStore, textareaRef, ensureComposerVisibleRef, onBatchPhotos: handleBatchPhotos });
  const selections = useChatSelections({ emissionStore, textareaRef });
  const { dispatchEmission, dispatchNativeEmission, sendVoiceSegment, sendStopSend } = useEmissionDispatch({
    send, captureCardSend: cardSend.capture, boxSlug, activeView, messages, emissionStore,
    selections: selections.selections, resetSelections: selections.resetSelections,
    resetAttachments: attach.resetAttachments,
  });
  // useChatVoice/useChatActions only ever fire-and-forget dispatchEmission
  // (its Promise<Receipt> is for callers that want to await the outcome,
  // per InteractiveChat-dispatch.ts) -- void it once here so both callees'
  // option types can stay honestly void-returning.
  const dispatchEmissionVoid = useCallback(
    (emission: Emission) => { void dispatchEmission(emission); },
    [dispatchEmission]
  );
  const voice = useChatVoice({
    snapshot, sessionId, muted: mute.muted, narrationEnabled: model.narrationEnabled,
    selections: selections.selections, resetSelections: selections.resetSelections,
    emissionStore, resetAttachments: attach.resetAttachments,
    clearDraftRef, inputStore, dispatchEmission: dispatchEmissionVoid, nativeComposer: usesNativeComposer,
  });
  useNativeBridges({
    enabled: usesNativeShell, dispatchEmission: dispatchNativeEmission, boxSlug,
    narrationEnabled: model.narrationEnabled, responseActive: snapshot.value === "streaming",
    speechPlaying: voice.speechPlayback.isPlaying, stopSpeech: voice.handleStopSpeech });
  useEnsureComposerVisible({ ensureComposerVisibleRef, isTranscribing: voice.isTranscribing, setTypingMode, textareaRef });

  // Persisted in-flight transcript recovery widget; see InteractiveChat-recovery.tsx.
  const { recoveredDictation } = useRecoveredDictation({
    boxSlug,
    transcript: voice.transcription.transcript,
    isTranscribing: voice.isTranscribing,
    narrationEnabled: model.narrationEnabled,
    hqInFlight: voice.hqInFlight,
    sessionId,
    sendVoiceSegment,
    inputStore,
    startVoice: voice.startVoice,
    clearDraftRef,
  });
  const expiredAttachmentsNotice = (
    <ExpiredAttachmentsNotice names={expiredAttachments} onDismiss={dismissExpiredAttachments} />
  );

  useChatWs({
    sessionId, sessionInput, boxSlug, currentUser, isStreaming, send,
    fetchSchedules: schedules.fetchSchedules, setChatFeatures: model.setChatFeatures,
    onTaskEvent: backgroundTasks.onTaskEvent,
    onCaptureStatus: applyCaptureStatus,
    onScreenshotRequest: screenshots.onScreenshotRequest,
    onSessionAssignment,
    audioOverlayStore,
  });
  const actions = useChatActions({
    send, sessionId, boxSlug, effectiveContextDir, messages, totalEntries, loadingOlder, setLoadingOlder,
    inputStore, emissionStore,
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

  if (isLoading) return <ChatLoading />;

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
      boxSlug={boxSlug} sessionLabel={sessionLabel}
      messages={messages}
      groups={groups}
      backgroundTasks={backgroundTasks.tasks}
      isStreaming={isStreaming}
      streamText={streamText}
      streamTools={streamTools}
      processBusy={Boolean(processBusy)} showAgentWorking={showAgentWorking}
      processRunning={processRunning}
      sessionId={sessionId}
      totalEntries={totalEntries}
      pendingCount={pendingMessages.filter((entry) => entry.pending === true).length}
      error={error}
      currentUserEmail={currentUser ? currentUser.email : undefined} currentUserName={currentUser ? currentUser.name : undefined}
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
      embedded={embedded === true}
      nativeComposer={usesNativeComposer}
      captureBubbles={captureBubbleList} onCaptureRetry={handleCaptureRetry}
      onEnterCapture={() => setCaptureMode(true)} captureEnabled={!usesNativeShell} captureDisabledReason={sessionId === null ? "Send a message first" : undefined}
      onUploadFiles={handleOpenBulkUpload} uploadFilesDisabledReason={sessionId === null ? "Send a message first" : undefined}
      screenshots={screenshots}
      audioOverlayStore={audioOverlayStore}
      />
      <ChatModeOverlays captureMode={captureMode} bulkUpload={bulkUploadLaunch} usesNativeShell={usesNativeShell} sessionId={sessionId} onExitCapture={() => setCaptureMode(false)} onExitBulkUpload={handleCloseBulkUpload} onBulkUploadDelivered={handleBulkUploadDelivered} />
    </InputStoreProvider>
  );
}

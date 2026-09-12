import { useWorkspace } from "./workspace/WorkspaceProvider";
import { invariant } from "@shared/invariant";
/**
 * InteractiveChat - the live chat UI for the box's conversational assistant.
 *
 * Streams messages from the backend ChatSession via SSE.
 * User input is wrapped in <typed> tags before sending.
 * User messages are right-aligned dark bubbles; assistant uses markdown.
 *
 * The box shell keeps this input owner mounted across navigation. Session
 * actors are selected or pinned independently, so switching conversations
 * replaces the transcript without discarding the draft or microphone.
 */

import { useState, useRef, useCallback, useEffect, useMemo, type ReactNode } from "react";
import { createAudioOverlayStore } from "./audio-overlay-store";
// search params read via window.location — avoids coupling to route definition
import { useConversationMachine } from "./conversation/use-conversation-machine";
import type { ConversationTarget, ConversationSelection, AttentionSnapshot } from "@shared/chat-composer-binding.js";
import type { ChatInitialLoad } from "../../machines/chat-types";
import { groupMessages } from "./ChatMessages";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useParams } from "@tanstack/react-router";
import { trpc } from "../../lib/trpc";
import { useEmissionDispatch } from "./InteractiveChat-dispatch";
import { useEmissionPersistence } from "../../hooks/useEmissionPersistence";
import { useRecoveryWidgets } from "./InteractiveChat-recovery";
import { useChatMute, useChatSchedules, usePendingMessagePoll, useChatStallRecovery } from "./InteractiveChat-hooks";
import { useChatModelFeatures } from "./use-chat-model";
import { useProcessingStatusPoll } from "./processing-status-display";
import { useCompanionCard } from "./InteractiveChat-card-hooks";
import { useChatAttachments, useEnsureComposerVisible } from "./InteractiveChat-attachments";
import { useChatSelections } from "./InteractiveChat-selections";
import { useChatVoice } from "./InteractiveChat-voice";
import { useChatWs } from "./InteractiveChat-ws";
import { useChatActions } from "./InteractiveChat-actions";
import { useBackgroundTasks } from "./BackgroundTasks";
import { InteractiveChatBody } from "./InteractiveChat-view";
import { createInputStoreAdapter, InputStoreProvider } from "./input-store";
import type { EmissionStore } from "../../input/emission-store";
import { useCaptureBubbles } from "./useCaptureBubbles";
import { CaptureOverlay } from "../capture/CaptureOverlay";
import { captureModeForRequest } from "../../lib/capture-intent";
import { useScreenshotRequests } from "./screenshot-request-handler";
import { useNativeBridges } from "./use-native-bridge";
import { useWorking } from "../DocumentTitle";
import { Text } from "../ui/Text";

function sendDisabledReasonFor(selection: ConversationSelection | undefined): string | undefined {
  return selection === undefined || selection.kind === "ready" ? undefined : selection.kind === "resolving" ? "Choosing conversation…" : selection.reason;
}

/**
 * Everything the chat derives from the directory it is bound to.
 *
 * `contextDir` is the prop value immediately for fresh "new" landmark chats
 * (the server hasn't seen the session id yet), falling back to the persisted
 * association for resumed sessions. `openers` are the `openers:` listed in
 * that directory's briefing — the suggestions a fresh chat's empty state
 * offers. Openers are fetched only for a `"new"` session: an existing session
 * with no messages is a different state, and offering openers there would read
 * as an invitation to start over.
 */
function useChatBinding(params: {
  sessionId: string | null;
  sessionInput: string;
  contextDir: string | undefined;
}): { contextDir: string | null; openers: string[] } {
  const query = trpc.chat.directoryFor.useQuery(
    { sessionId: params.sessionId ?? "" },
    { enabled: Boolean(params.sessionId) },
  );
  const queried = query.data ? query.data.contextDir : undefined;
  const contextDir = params.contextDir ?? queried ?? null;
  const isNew = params.sessionInput === "new";
  const openersQuery = trpc.chat.openers.useQuery({ contextDir: contextDir ?? "" }, { enabled: isNew });
  return { contextDir, openers: isNew && openersQuery.data ? openersQuery.data.openers : [] };
}

interface InteractiveChatProps {
  conversationTarget?: ConversationTarget;
  conversationSelection?: ConversationSelection;
  attention?: AttentionSnapshot;
  transcriptVisible?: boolean;
  ambientRegion?: ReactNode;
  selectionNotice?: ReactNode;
  /** Either an existing session id or `"new"` for a fresh conversation. */
  sessionInput: string;
  /**
   * If set on a `"new"` chat, the chat is bound to this landmark directory.
   * Sent to the backend on the first send; the SDK spawns with `cwd` set
   * there and the association is persisted to chat-session-history. Once
   * the session id is assigned, future resumes look it up server-side.
   */
  contextDir?: string;
  /** Engine and model chosen before this chat exists (fresh chats only). */
  startEngine?: string;
  startModel?: string;
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
  /** Preserve web chrome while suppressing input for a native shell. */
  nativeComposer?: boolean;
  /**
   * Open capture mode for each `/capture` deep-link request. The shell consumes
   * `?capture=1`; a later request must still work while this runtime is retained.
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
  onSessionAssignment?: (sessionId: string, assignment?: { clientConversationId: string; contextDir: string }) => void;
}

/**
 * The full-screen composer overlay (capture), kept out of the InteractiveChat
 * body so it carries one line rather than the gating. Suppressed for native
 * shells, which run their own.
 *
 * This was two overlays until the composer stopped sending files to the
 * bulk-upload batch: routing now attaches them to the message being written
 * instead, so nothing opened the bulk one any more
 * (`issues/bugs/2026-09-06-add-files-cannot-attach-a-couple-of-files-inline.md`).
 */
function ChatModeOverlays({ captureMode, usesNativeShell, sessionId, onExitCapture }: {
  captureMode: boolean;
  usesNativeShell: boolean;
  sessionId: string | null;
  onExitCapture: () => void;
}) {
  if (!captureMode || usesNativeShell) return null;
  return <CaptureOverlay targetSessionId={sessionId} onExit={onExitCapture} />;
}

/** Presentation toggles stay with the box input, independently of session actors. */
function useChatFrameState(openCaptureOnMount: boolean | undefined) {
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sendSignal, setSendSignal] = useState(0);
  const bumpSendSignal = useCallback(() => setSendSignal((n) => n + 1), []);
  const [debugView, setDebugView] = useState(false);
  const [showDebugLog, setShowDebugLog] = useState(false);
  const [typingMode, setTypingMode] = useState(false);
  const [typingLocked, setTypingLocked] = useState(false);
  // Capture mode: a rare user toggle (frame state, not URL / per-keystroke), so
  // it lives in root state; the overlay's recording-timer ticks stay in its own
  // subtree. Seeded from the `?capture=1` deep link, consumed once.
  const [captureMode, setCaptureMode] = useState(openCaptureOnMount === true);
  useEffect(() => {
    if (openCaptureOnMount === true) setCaptureMode((current) => captureModeForRequest(current, true));
  }, [openCaptureOnMount]);
  return { loadingOlder, setLoadingOlder, sendSignal, bumpSendSignal, debugView, setDebugView, showDebugLog, setShowDebugLog, typingMode, setTypingMode,
    typingLocked, setTypingLocked, captureMode, setCaptureMode };
}

export function InteractiveChat({ sessionInput, contextDir, startEngine, startModel, emissionStore, nativeComposer, openCaptureOnMount, initial, sessionLabel, onSessionAssignment, conversationTarget, conversationSelection, attention, transcriptVisible, ambientRegion, selectionNotice }: InteractiveChatProps) {
  const usesNativeComposer = nativeComposer === true; const usesNativeShell = usesNativeComposer;
  const { boxSlug } = useParams({ strict: false });
  const { snapshot, send, pool, target, recoveryNotice } = useConversationMachine({
    boxSlug: boxSlug ?? "default", target: conversationTarget,
    input: { sessionInput, contextDir, startEngine, startModel, initial }, onSessionAssignment,
  });
  const { messages, pendingMessages, streamText, streamTools, error, sessionId, processRunning, processBusy, totalEntries, liveTurnId } = snapshot.context;
  const { contextDir: effectiveContextDir, openers } = useChatBinding({ sessionId, sessionInput, contextDir });
  const isStreaming = snapshot.matches("streaming") || snapshot.matches("refreshing");
  // Put the turn in the tab title, so a chat left in a background tab says
  // whether the box is still working on it. The deps are one boolean, so this
  // publishes once per turn rather than once per streamed token.
  useWorking(isStreaming);
  const currentUser = useCurrentUser();
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
  const { loadingOlder, setLoadingOlder, sendSignal, bumpSendSignal, debugView, setDebugView, showDebugLog, setShowDebugLog, typingMode, setTypingMode,
    typingLocked, setTypingLocked, captureMode, setCaptureMode } = useChatFrameState(openCaptureOnMount);
  // Server-derived pending capture bubbles (survive reload; refined live below).
  const { bubbles: captureBubbleList, applyCaptureStatus, verbs: captureVerbs } = useCaptureBubbles(sessionId);
  const screenshots = useScreenshotRequests(sessionId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const groups = useMemo(() => groupMessages(messages), [messages]);

  const logicalConversation = pool.conversationIdentity(target);
  const model = useChatModelFeatures({ conversationKey: logicalConversation, sessionId, contextDir: effectiveContextDir, groupCount: groups.length, send, startEngine, startModel });
  const mute = useChatMute();
  const tabs = useWorkspace();
  invariant(tabs, "InteractiveChat requires WorkspaceProvider");
  const { activeView } = tabs;
  const cardSend = useCompanionCard({ focusedRef: attention?.focusedRef, activeView });
  const schedules = useChatSchedules({ messages, loaded: !snapshot.matches("loading"), isStreaming, send });
  usePendingMessagePoll({ pendingCount: pendingMessages.filter((entry) => entry.pending === true).length, sessionId, send });
  const showAgentWorking = useProcessingStatusPoll({ processBusy: Boolean(processBusy), snapshot, sessionId, send });
  useChatStallRecovery({ isStreamingState: snapshot.matches("streaming"), sessionId, send });

  // The one user-send funnel: every send site builds an Emission and lands
  // in dispatchEmission (docs/implemented-plans/input-extraction.md chunk 1); assembly
  // and witness capture live in InteractiveChat-dispatch.ts.
  // Assigned by useEnsureComposerVisible below (it needs voice state) — the
  // same ref pattern as clearDraftRef.
  const ensureComposerVisibleRef = useRef<() => void>(() => {});
  // Set by the draft hook further down; threaded into voice so a committed
  // segment drops the persisted draft. A ref breaks the voice→draft→voice
  // cycle.
  const clearDraftRef = useRef<() => void>(() => {});
  const attach = useChatAttachments({ emissionStore, textareaRef, ensureComposerVisibleRef });
  const selections = useChatSelections({ emissionStore, textareaRef });
  const { captureEmissionDispatch, dispatchNativeEmission, sendVoiceSegment, sendStopSend, failedRegion } = useEmissionDispatch({
    send, pool, target, selection: conversationSelection, attention,
    captureCardSend: cardSend.capture, acceptCardSend: cardSend.accepted, boxSlug, activeView, messages, emissionStore,
    selections: selections.selections, resetSelections: selections.resetSelections,
    resetAttachments: attach.resetAttachments, awaitPendingUploads: attach.awaitPendingUploads,
    onSent: bumpSendSignal,
  });
  const voice = useChatVoice({
    conversationKey: logicalConversation,
    snapshot, sessionId, muted: mute.muted, narrationEnabled: model.narrationEnabled,
    hqDictationEnabled: model.hqDictationEnabled,
    selections: selections.selections, resetSelections: selections.resetSelections,
    emissionStore, resetAttachments: attach.resetAttachments,
    clearDraftRef, inputStore, captureEmissionDispatch, nativeComposer: usesNativeComposer,
    awaitPendingUploads: attach.awaitPendingUploads,
  });
  useNativeBridges({
    enabled: usesNativeShell, dispatchEmission: dispatchNativeEmission, boxSlug, sessionId,
    narrationEnabled: model.narrationEnabled, hqDictationEnabled: model.hqDictationEnabled, responseActive: snapshot.value === "streaming",
    speechPlaying: voice.speechPlayback.isPlaying, stopSpeech: voice.handleStopSpeech });
  useEnsureComposerVisible({ ensureComposerVisibleRef, isTranscribing: voice.isTranscribing, setTypingMode, textareaRef });

  // Persisted in-flight transcript recovery widget + the expired-attachments
  // notice; see InteractiveChat-recovery.tsx (combined there to keep this
  // component under the line-count limit).
  const { recoveredDictation, expiredAttachmentsNotice } = useRecoveryWidgets({
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
    expiredAttachments,
    dismissExpiredAttachments,
  });

  useChatWs({
    sessionId, sessionInput, boxSlug, currentUser, isStreaming, send,
    fetchSchedules: schedules.fetchSchedules, setChatFeatures: model.setChatFeatures,
    onTaskEvent: backgroundTasks.onTaskEvent,
    onCaptureStatus: applyCaptureStatus,
    onScreenshotRequest: screenshots.onScreenshotRequest,
    shellManaged: true,
    audioOverlayStore,
  });
  const actions = useChatActions({
    send, sessionId, boxSlug, effectiveContextDir, messages, totalEntries, loadingOlder, setLoadingOlder,
    inputStore, emissionStore,
    resetAttachments: attach.resetAttachments, resetSelections: selections.resetSelections,
    // Both addFiles and dispatchEmission already catch their own errors
    // internally; voided here so useChatActions' option types can stay
    // honestly void-returning.
    addFiles: (files) => { void attach.addFiles(files); }, awaitPendingUploads: attach.awaitPendingUploads,
    onSend: voice.notifySent, isTranscribing: voice.isTranscribing, textareaRef,
    transcriptTick: voice.transcription.transcript, typingMode, typingLocked, setTypingMode,
    captureEmissionDispatch, sendDisabledReason: sendDisabledReasonFor(conversationSelection),
  });

  // Loading changes the transcript, never the input service owner.

  return (
    <InputStoreProvider value={inputStore}>
      <InteractiveChatBody
      conversationKey={logicalConversation}
      sendDisabledReason={sendDisabledReasonFor(conversationSelection)}
      transcriptVisible={transcriptVisible}
      ambientRegion={ambientRegion} selectionNotice={<>{selectionNotice}{recoveryNotice !== null && <div role="alert"><Text size="sm" tone="danger">{recoveryNotice}</Text></div>}</>} failedRegion={failedRegion}
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
      sendSignal={sendSignal} liveTurnId={liveTurnId}
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
      nativeComposer={usesNativeComposer}
      captureBubbles={captureBubbleList} captureVerbs={captureVerbs}
      onEnterCapture={() => setCaptureMode(true)} captureEnabled={!usesNativeShell} captureDisabledReason={sessionId === null ? "Send a message first" : undefined}
      screenshots={screenshots}
      audioOverlayStore={audioOverlayStore}
      openers={openers}
      />
      <ChatModeOverlays captureMode={captureMode} usesNativeShell={usesNativeShell} sessionId={sessionId} onExitCapture={() => setCaptureMode(false)} />
    </InputStoreProvider>
  );
}

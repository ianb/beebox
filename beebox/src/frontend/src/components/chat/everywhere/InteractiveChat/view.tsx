/**
 * The full rendered tree for InteractiveChat, lifted out of the main
 * component so that component stays a thin "run the hooks, hand off the view
 * model" shell. Receives the hook result objects (tabs, model, voice,
 * attachments, actions, schedules) plus the machine-derived scalars, and
 * wires them into the layout regions.
 */

import { useCallback, useMemo } from "react";
import { WorkspaceCanvas } from "../../workspace/WorkspaceCanvas/view";
import { MessageList } from "./messages";
import {
  ChatView, ChatStatusBanners, ChatComposerSection, ChatInputArea, MobileTextareaRow,
} from "../../InteractiveChat-layout/view";
import { ChatBarChrome } from "./ChatBarChrome";
import { TargetStrip } from "../../TargetStrip";
import { chatTargetStatus } from "../../../../input/targets/chat-target";
import { DebugLogPanel } from "../../../DebugLog";
import { BackgroundTasks } from "./BackgroundTasks";
import { ScreenshotRequestUI } from "./ScreenshotRequestUI";
import { useChatAttachmentValues } from "../../InteractiveChat-attachments/attachments";
import { useCompanionSelection } from "./use-companion-selection";
import type { ChatBodyProps } from "./body-props";
import { useCurrentUser } from "../../../../hooks/useCurrentUser";
import { useNavigate, useParams } from "@tanstack/react-router";
import { href, toSearch } from "../../../../lib/routing";
import type { ChatAgentEngine } from "@shared/chat-models.js";
import { ChatRenderProfiler } from "./ChatRenderProfiler";
import { AgentGate } from "../../../agents/AgentReadiness";
import { PlaceChatContext, type PlaceChat } from "../../../openers/place-chat";
import { useWorkspace } from "../../workspace/WorkspaceProvider/provider";


/**
 * The chat's app-bar publications (Track C2). Renders only portals — the
 * chips land in the bar's chip slots, the here menu in the pill's dropdown.
 * Every prop below is a primitive or a stable callback so the memoized
 * children don't reconcile per streaming token.
 */
function BarChromeRegion(props: ChatBodyProps) {
  const {
    tabs, model, mute, voice, actions, effectiveContextDir, boxSlug, sessionLabel, messages,
    sessionId, processRunning, isStreaming, debugView, setDebugView, showDebugLog, setShowDebugLog,
  } = props;
  const { onZoomView } = tabs;
  const { agentEngine, selectedModel, modelInForce, boxDefault, enabledEngines, boxEngine, handlePinModel, handleOpenModelPanel, narrationEnabled, handleToggleNarration, handleSelectModel } = model;
  // Pinning writes box configuration, so it is the owner's control — the same
  // signal the dashboard uses for its owner-only actions.
  const currentUser = useCurrentUser();
  const canPin = currentUser?.isOwner === true;
  // A chat's engine is fixed by its first message. Before that there is nothing
  // to lose by starting over on another engine — after it, the transcript lives
  // in that engine's store and cannot be handed across.
  const canChooseEngine = messages.length === 0;
  const navigate = useNavigate();
  const { boxSlug: routeBoxSlug } = useParams({ strict: false });
  /**
   * Start this chat again on another engine.
   *
   * A coined chat id is reserved against Claude, so switching engines cannot
   * reuse it — the chat goes back through `?session=new` carrying the choice,
   * and the abandoned reservation expires on its own. Nothing is lost: this is
   * only reachable before the first message.
   */
  const handleChooseStart = useCallback((choice: { engine: ChatAgentEngine; model: string | null }) => {
    if (routeBoxSlug === undefined) return;
    void navigate({
      to: href(`/${routeBoxSlug}/chat`),
      search: toSearch({
        session: "new",
        engine: choice.engine,
        ...(choice.model !== null ? { model: choice.model } : {}),
        ...(effectiveContextDir !== null ? { contextDir: effectiveContextDir } : {}),
      }),
    });
  }, [navigate, routeBoxSlug, effectiveContextDir]);

  /**
   * Set this chat's model.
   *
   * A chat with an id can hold one server-side. A chat without one cannot —
   * `setModel` has nothing to address — so its choice has to ride the first
   * send, which is the same restart-with-the-choice path a cross-engine pick
   * takes. Without this the menu showed "switched" while the send carried
   * nothing (found in cross-model review).
   */
  const handleSelectOwnModel = useCallback((chosen: string | null) => {
    if (sessionId === null && agentEngine !== null) {
      handleChooseStart({ engine: agentEngine, model: chosen });
      return;
    }
    handleSelectModel(chosen);
  }, [sessionId, agentEngine, handleChooseStart, handleSelectModel]);
  return (
    <ChatBarChrome
      transcriptVisible={props.transcriptVisible ?? true}
      contextDir={effectiveContextDir}
      boxSlug={boxSlug}
      sessionLabel={sessionLabel}
      messages={messages}
      onZoomView={onZoomView}
      muted={mute.muted}
      onToggleMute={mute.handleToggleMute}
      narrationEnabled={narrationEnabled}
      onToggleNarration={handleToggleNarration}
      hqInFlight={voice.hqInFlight}
      onNewSession={actions.handleNewSession}
      selectedModel={selectedModel}
      modelInForce={modelInForce}
      boxDefault={boxDefault}
      canPin={canPin}
      canChooseEngine={canChooseEngine}
      enabledEngines={enabledEngines}
      boxEngine={boxEngine}
      onChooseStart={handleChooseStart}
      onPinModel={handlePinModel}
      onOpenModelPanel={handleOpenModelPanel}
      agentEngine={agentEngine}
      onSelectModel={handleSelectOwnModel}
      onStopProcess={actions.handleStopProcess}
      onRestartProcess={actions.handleRestartProcess}
      onCompactSession={actions.handleCompactSession}
      sessionId={sessionId}
      running={processRunning}
      busy={isStreaming}
      debugView={debugView}
      setDebugView={setDebugView}
      showDebugLog={showDebugLog}
      setShowDebugLog={setShowDebugLog}
    />
  );
}

function MessageListRegion(props: ChatBodyProps) {
  const {
    tabs, model, voice, actions, messages, groups, modelMarkers, isStreaming, streamText, streamTools,
    debugView, currentUserEmail, currentUserName, snapshot, totalEntries, loadingOlder, sendSignal, liveTurnId,
    captureBubbles, captureVerbs, audioOverlayStore, openers,
  } = props;
  const { onZoomView } = tabs;
  const { speechPlayback, handleStopSpeech, handleSkipSpeech, handleReplaySpeech, pendingHq, sendHqLive } = voice;
  const { handleLoadOlder } = actions;
  return (
    <ChatRenderProfiler id="message-list">
      <MessageList
      messages={messages}
      groups={groups}
      modelMarkers={modelMarkers}
      isStreaming={isStreaming}
      streamText={streamText}
      streamTools={streamTools}
      debugView={debugView}
      currentUserEmail={currentUserEmail}
      currentUserName={currentUserName}
      speechPlayback={speechPlayback}
      handleStopSpeech={handleStopSpeech}
      handleSkipSpeech={handleSkipSpeech}
      handleReplaySpeech={handleReplaySpeech}
      onZoomView={onZoomView}
      snapshot={snapshot}
      totalEntries={totalEntries}
      onLoadOlder={handleLoadOlder}
      loadingOlder={loadingOlder}
      sendSignal={sendSignal}
      liveTurnId={liveTurnId}
      proseEnabled={model.chatFeatures.prose !== "off"}
      pendingHq={pendingHq}
      onHqSendLive={sendHqLive}
      captureBubbles={captureBubbles}
      captureVerbs={captureVerbs}
      audioOverlayStore={audioOverlayStore}
      openers={openers}
      onSendOpener={actions.handleSendOpener}
      />
    </ChatRenderProfiler>
  );
}

function ComposerRegion(props: ChatBodyProps) {
  const {
    model, voice, recoveredDictation, expiredAttachmentsNotice, attach, selections, actions, isStreaming, processBusy, textareaRef,
    typingMode, setTypingMode, typingLocked, setTypingLocked, onVoiceSegmentSend, onEnterCapture, captureEnabled, captureDisabledReason,
  } = props;
  const { transcription, isTranscribing, voicePaused, stopDictation, clearDraft, handleCancelTranscription, startVoice, unpauseVoice } = voice;
  const { fileInputRef, removeAttachment, removeFileAttachment, retryFileUpload, handleAddFiles, handleFileInputChange, addFiles } = attach;
  // Subscribed here, not at the InteractiveChat root — a paste/upload must
  // only re-render this composer region, not the companion view pane
  // (see InteractiveChat-attachments.ts module doc).
  const { attachments, pendingImageCount, fileAttachments } = useChatAttachmentValues();
  const { selections: selectionItems, removeSelection } = selections;
  const { handleSend, handleKeyDown, handlePaste, handleDrop } = actions;
  const targetBusy = chatTargetStatus({ isStreaming, processBusy }).state === "busy";
  return (
    <ChatRenderProfiler id="composer">
      <ChatComposerSection
      attachments={attachments}
      pendingImageCount={pendingImageCount}
      fileAttachments={fileAttachments}
      selections={selectionItems}
      onRemoveSelection={removeSelection}
      onRemoveAttachment={removeAttachment}
      onRemoveFileAttachment={removeFileAttachment}
      onRetryFileAttachment={retryFileUpload}
      fileInputRef={fileInputRef}
      onFileInputChange={handleFileInputChange}
      typingMode={typingMode}
      typingLocked={typingLocked}
      setTypingMode={setTypingMode}
      setTypingLocked={setTypingLocked}
      isTranscribing={isTranscribing}
      recoveredDictation={recoveredDictation}
      expiredAttachmentsNotice={expiredAttachmentsNotice}
      inputArea={
        <ChatInputArea
          hideMobile={typingMode}
          textareaRef={textareaRef}
          isTranscribing={isTranscribing}
          transcription={transcription}
          targetBusy={targetBusy}
          sendDisabledReason={props.sendDisabledReason}
          handleKeyDown={handleKeyDown}
          handleSend={handleSend}
          handleCancelTranscription={handleCancelTranscription}
          clearDraft={clearDraft}
          onKeyboard={() => setTypingMode(true)}
          onVoice={startVoice}
          onStopDictation={stopDictation}
          onVoiceSegmentSend={onVoiceSegmentSend}
          voicePaused={voicePaused}
          onUnpause={unpauseVoice}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onAddFiles={handleAddFiles}
          addFiles={addFiles}
          onEnterCapture={onEnterCapture}
          captureEnabled={captureEnabled}
          captureDisabledReason={captureDisabledReason}
          narrationEnabled={model.narrationEnabled}
        />
      }
      mobileRow={
        <MobileTextareaRow
          isTranscribing={isTranscribing}
          transcription={transcription}
          targetBusy={targetBusy}
          sendDisabledReason={props.sendDisabledReason}
          handleSend={handleSend}
          handleCancelTranscription={handleCancelTranscription}
          clearDraft={clearDraft}
          onStopDictation={stopDictation}
          onVoiceSegmentSend={onVoiceSegmentSend}
          onPaste={handlePaste}
          onDrop={handleDrop}
        />
      }
      />
    </ChatRenderProfiler>
  );
}

/**
 * What a place page in this chat's workspace needs to know about the chat
 * (`PlaceView`, "Start something"). Memoized on its four inputs so a streamed
 * token does not re-render the cards that read it.
 */
function usePlaceChat(props: ChatBodyProps): PlaceChat {
  const { effectiveContextDir: contextDir, unstarted, messages, isStreaming, processBusy, actions: { handleSendOpener: sendOpener } } = props;
  const showsOwnOpeners = unstarted && messages.length === 0 && !isStreaming;
  const busy = chatTargetStatus({ isStreaming, processBusy }).state === "busy";
  return useMemo(() => ({ contextDir, showsOwnOpeners, busy, sendOpener }), [contextDir, showsOwnOpeners, busy, sendOpener]);
}

export function InteractiveChatBody(props: ChatBodyProps) {
  const { voice, selections, schedules, error, pendingCount, showAgentWorking, actions, showDebugLog, setShowDebugLog, send, nativeComposer } = props;
  const { handleAddSelection, nativeCommandError, dismissNativeCommandError } = useCompanionSelection({ nativeComposer, selections, voice });
  const placeChat = usePlaceChat(props);
  const cancelArrival = useWorkspace()?.cancelArrival;
  return (
    <ChatRenderProfiler id="chat-root">
      <ChatView
      onPaneInteraction={cancelArrival}
      ambientRegion={props.ambientRegion} selectionNotice={props.selectionNotice} failedRegion={props.failedRegion}
      // Native input replaces only the composer; landmark and settings menus remain web-owned.
      barChrome={<BarChromeRegion {...props} />}
      workspace={<PlaceChatContext.Provider value={placeChat}><WorkspaceCanvas onAddSelection={handleAddSelection} reportActivity={props.reportCardActivity}>
        <MessageListRegion key={props.conversationKey} {...props} />
      </WorkspaceCanvas></PlaceChatContext.Provider>}
      statusBanners={
        <>
          <BackgroundTasks tasks={props.backgroundTasks} />
          <ScreenshotRequestUI controller={props.screenshots} />
          <ChatStatusBanners
            error={nativeCommandError ?? error}
            transcriptionError={voice.transcription.error}
            onDismissError={() => {
              if (nativeCommandError !== null) {
                dismissNativeCommandError();
              } else {
                send({ type: "DISMISS_ERROR" });
                voice.transcription.dismissError();
              }
            }}
            activeSchedules={schedules.activeSchedules}
            onCancelSchedule={schedules.handleCancelSchedule}
          />
          <TargetStrip
            status={chatTargetStatus({ isStreaming: showAgentWorking, processBusy: false })}
            pendingCount={pendingCount}
            isStreaming={showAgentWorking}
            onInterrupt={actions.handleInterrupt}
            speechPlaying={voice.speechPlayback.isPlaying}
            onStopSpeech={voice.handleStopSpeech}
          />
        </>
      }
      composerSection={nativeComposer ? null : <AgentGate><ComposerRegion {...props} /></AgentGate>}
        debugLog={showDebugLog ? <DebugLogPanel onClose={() => setShowDebugLog(false)} /> : null}
      />
    </ChatRenderProfiler>
  );
}

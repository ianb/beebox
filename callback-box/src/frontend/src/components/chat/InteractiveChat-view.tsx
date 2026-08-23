/**
 * The full rendered tree for InteractiveChat, lifted out of the main
 * component so that component stays a thin "run the hooks, hand off the view
 * model" shell. Receives the hook result objects (tabs, model, voice,
 * attachments, actions, schedules) plus the machine-derived scalars, and
 * wires them into the layout regions.
 */

import { useCallback, type ReactNode } from "react";
import { CompanionViewPanel } from "./InteractiveChat-controls";
import type { NavigateHint, ViewTarget } from "../../lib/view-url";
import { MessageList } from "./InteractiveChat-messages";
import {
  ChatView, ChatStatusBanners, ChatComposerSection, ChatInputArea, MobileTextareaRow,
} from "./InteractiveChat-layout";
import { ChatBarChrome } from "./ChatBarChrome";
import { TargetStrip } from "./TargetStrip";
import { chatTargetStatus } from "../../input/targets/chat-target";
import { DebugLogPanel } from "../DebugLog";
import { BackgroundTasks } from "./BackgroundTasks";
import { ScreenshotRequestUI } from "./ScreenshotRequestUI";
import type { ScreenshotRequestController } from "./screenshot-request-handler";
import type { LiveTask } from "./background-tasks";
import type { SessionEntry, SessionContentBlock } from "../../api";
import type { MessageGroup } from "./ChatMessages";
import type { ModelMarker, VoiceSegmentSend } from "./InteractiveChat-helpers";
import type { useChatTabs, useChatModelFeatures, useChatMute, useChatSchedules } from "./InteractiveChat-hooks";
import type { useChatVoice } from "./InteractiveChat-voice";
import { useChatAttachmentValues, type useChatAttachments } from "./InteractiveChat-attachments";
import type { useChatSelections } from "./InteractiveChat-selections";
import type { useChatActions } from "./InteractiveChat-actions";
import type { ActivityKind } from "@core/chat/card-activity.js";
import type { CaptureBubbleModel, CaptureVerbs } from "./capture-bubble";
import type { AudioOverlayStore } from "./audio-overlay-store";
import { useCompanionSelection } from "./use-companion-selection";

interface ChatBodyProps {
  tabs: ReturnType<typeof useChatTabs>;
  model: ReturnType<typeof useChatModelFeatures>;
  mute: ReturnType<typeof useChatMute>;
  voice: ReturnType<typeof useChatVoice>;
  /** Recovery widget for an interrupted dictation, or null when none is pending. */
  recoveredDictation: ReactNode;
  /** Dismissible notice for attachments dropped on emission restore, or null when none. */
  expiredAttachmentsNotice: ReactNode;
  attach: ReturnType<typeof useChatAttachments>;
  selections: ReturnType<typeof useChatSelections>;
  actions: ReturnType<typeof useChatActions>;
  schedules: ReturnType<typeof useChatSchedules>;
  effectiveContextDir: string | null;
  boxSlug: string | undefined;
  /** The session's display name (`chat.bootstrap`'s `label`) — the session chip's face. */
  sessionLabel: string | null;
  messages: SessionEntry[];
  groups: MessageGroup[];
  backgroundTasks: LiveTask[];
  isStreaming: boolean;
  streamText: string;
  streamTools: SessionContentBlock[];
  processBusy: boolean;
  /** Confirmed display state; raw processBusy still owns queue affordances. */
  showAgentWorking: boolean;
  processRunning: boolean;
  sessionId: string | null; totalEntries: number;
  pendingCount: number; error: string | null | undefined;
  currentUserEmail: string | undefined; currentUserName: string | undefined;
  modelMarkers: ModelMarker[];
  loadingOlder: boolean;
  scrollToBottomTrigger: number;
  liveTurnId: string | null;
  snapshot: { matches: (state: "loading" | "idle" | "streaming" | "refreshing") => boolean };
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  debugView: boolean;
  setDebugView: React.Dispatch<React.SetStateAction<boolean>>;
  showDebugLog: boolean;
  setShowDebugLog: React.Dispatch<React.SetStateAction<boolean>>;
  typingMode: boolean;
  setTypingMode: React.Dispatch<React.SetStateAction<boolean>>;
  typingLocked: boolean;
  setTypingLocked: React.Dispatch<React.SetStateAction<boolean>>;
  onVoiceSegmentSend: VoiceSegmentSend;
  send: (event: { type: "DISMISS_ERROR" }) => void;
  /** Report user activity on the open companion card (scrolled/navigated/…). */
  reportCardActivity: (kind: ActivityKind, detail?: string) => void;
  /**
   * Native shell modes: embed also suppresses the header, while nativeComposer
   * keeps the normal web chrome. Both suppress the web input surface.
   */
  embedded: boolean;
  nativeComposer: boolean;
  /** Pending capture bubbles (Track 4), and the two verbs a failed one offers. */
  captureBubbles: CaptureBubbleModel[];
  captureVerbs: CaptureVerbs;
  /** Enter capture mode (open the full-screen capture overlay). */
  onEnterCapture: () => void;
  /** Whether the capture affordance is offered (suppressed for native shells). */
  captureEnabled: boolean;
  /**
   * When set, the capture affordance is shown but disabled, with this string as
   * its tooltip — used before a fresh chat has a server-assigned session id, so
   * a capture can't misdirect into another chat (X1).
   */
  captureDisabledReason?: string | undefined;
  /** Agent-initiated screenshot requests: FIFO consent popup + ephemeral indicator rows. */
  screenshots: ScreenshotRequestController;
  audioOverlayStore: AudioOverlayStore; // written by the audio-review events; read by UserMessage's badges
  /**
   * Suggested opening questions for the empty state of a fresh chat, from the
   * bound directory's briefing (`chat.openers`). Empty for a resumed session
   * and for any box whose agent has retired its openers.
   */
  openers: string[];
}

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
  const { agentEngine, selectedModel, narrationEnabled, handleToggleNarration, handleSelectModel } = model;
  return (
    <ChatBarChrome
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
      agentEngine={agentEngine}
      onSelectModel={handleSelectModel}
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
    debugView, currentUserEmail, currentUserName, snapshot, totalEntries, loadingOlder, scrollToBottomTrigger, liveTurnId,
    captureBubbles, captureVerbs, audioOverlayStore, openers,
  } = props;
  const { onZoomView } = tabs;
  const { speechPlayback, handleStopSpeech, handleSkipSpeech, handleReplaySpeech, pendingHqDraft } = voice;
  const { handleLoadOlder } = actions;
  return (
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
      scrollToBottomTrigger={scrollToBottomTrigger}
      liveTurnId={liveTurnId}
      proseEnabled={model.chatFeatures.prose !== "off"}
      pendingHqDraft={pendingHqDraft}
      captureBubbles={captureBubbles}
      captureVerbs={captureVerbs}
      audioOverlayStore={audioOverlayStore}
      openers={openers}
      onSendOpener={actions.handleSendOpener}
    />
  );
}

function ComposerRegion(props: ChatBodyProps) {
  const {
    model, voice, recoveredDictation, expiredAttachmentsNotice, attach, selections, actions, isStreaming, processBusy, textareaRef,
    typingMode, setTypingMode, typingLocked, setTypingLocked, onVoiceSegmentSend, onEnterCapture, captureEnabled,
    captureDisabledReason,
  } = props;
  const { transcription, isTranscribing, voicePaused, stopDictation, clearDraft, handleCancelTranscription, startVoice, unpauseVoice } = voice;
  const { fileInputRef, removeAttachment, removeFileAttachment, handleAddFiles, handleFileInputChange, addFiles } = attach;
  // Subscribed here, not at the InteractiveChat root — a paste/upload must
  // only re-render this composer region, not the companion view pane
  // (see InteractiveChat-attachments.ts module doc).
  const { attachments, pendingImageCount, fileAttachments } = useChatAttachmentValues();
  const { selections: selectionItems, removeSelection } = selections;
  const { handleSend, handleKeyDown, handlePaste, handleDrop } = actions;
  const targetBusy = chatTargetStatus({ isStreaming, processBusy }).state === "busy";
  return (
    <ChatComposerSection
      attachments={attachments}
      pendingImageCount={pendingImageCount}
      fileAttachments={fileAttachments}
      selections={selectionItems}
      onRemoveSelection={removeSelection}
      onRemoveAttachment={removeAttachment}
      onRemoveFileAttachment={removeFileAttachment}
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
  );
}

export function InteractiveChatBody(props: ChatBodyProps) {
  const { tabs, voice, selections, schedules, error, pendingCount, showAgentWorking, actions, showDebugLog, setShowDebugLog, send, embedded, nativeComposer } = props;
  const { panel, activeView, onZoomView, onSelectTab, onCloseTab, onClosePanel } = tabs;
  const {
    handleAddSelection,
    nativeCommandError,
    dismissNativeCommandError,
  } = useCompanionSelection({ nativeComposer, selections, voice });
  // Stable across a submit so the memoized companion pane doesn't re-render
  // when the chat machine's snapshot churns (see CompanionViewPanel's memo).
  const { reportCardActivity } = props;
  const handleCompanionNavigate = useCallback(
    (target: ViewTarget, hint?: NavigateHint) => {
      // A link followed within the pane is active consumption; the detail is
      // where they navigated to.
      reportCardActivity("navigated", target.path);
      onZoomView({ target, label: hint && hint.label ? hint.label : target.path });
    },
    [reportCardActivity, onZoomView],
  );
  return (
    <ChatView
      hasCompanion={Boolean(activeView)}
      companionPanel={
        activeView ? (
          <CompanionViewPanel
            tabs={panel.tabs}
            activePath={activeView.target.path}
            onSelectTab={onSelectTab}
            onCloseTab={onCloseTab}
            onClosePanel={onClosePanel}
            onNavigate={handleCompanionNavigate}
            onAddSelection={handleAddSelection}
            reportActivity={reportCardActivity}
          />
        ) : null
      }
      barChrome={embedded ? null : <BarChromeRegion {...props} />}
      messageList={<MessageListRegion {...props} />}
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
      composerSection={embedded || nativeComposer ? null : <ComposerRegion {...props} />}
      debugLog={showDebugLog ? <DebugLogPanel onClose={() => setShowDebugLog(false)} /> : null}
    />
  );
}

/**
 * The full rendered tree for InteractiveChat, lifted out of the main
 * component so that component stays a thin "run the hooks, hand off the view
 * model" shell. Receives the hook result objects (tabs, model, voice,
 * attachments, actions, schedules) plus the machine-derived scalars, and
 * wires them into the layout regions.
 */

import { useRef, useCallback, useEffect, type ReactNode } from "react";
import { CompanionViewPanel } from "./InteractiveChat-controls";
import { MessageList } from "./InteractiveChat-messages";
import { ChatContextDirProvider } from "./chat-context-dir";
import { lastWords, countWords } from "../../lib/selection/serialize";
import type { AddSelectionInput } from "../../lib/selection/position";
import {
  ChatView, ChatHeader, ChatDebugMenu, ChatStatusBanners, ChatComposerSection, ChatInputArea, MobileTextareaRow,
} from "./InteractiveChat-layout";
import { TargetStrip } from "./TargetStrip";
import { chatTargetStatus } from "../../input/targets/chat-target";
import { DebugLogPanel } from "../DebugLog";
import { BackgroundTasks } from "./BackgroundTasks";
import type { LiveTask } from "./background-tasks";
import type { SessionEntry, SessionContentBlock } from "../../api";
import type { MessageGroup } from "./ChatMessages";
import type { ModelMarker } from "./InteractiveChat-helpers";
import type { useChatTabs, useChatModelFeatures, useChatMute, useChatSchedules } from "./InteractiveChat-hooks";
import type { useChatVoice } from "./InteractiveChat-voice";
import { useChatAttachmentValues, type useChatAttachments } from "./InteractiveChat-attachments";
import type { useChatSelections } from "./InteractiveChat-selections";
import type { useChatActions } from "./InteractiveChat-actions";
import type { ActivityKind } from "../../../../core/chat/card-activity.js";
import type { CaptureBubbleModel } from "./capture-bubble";

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
  messages: SessionEntry[];
  groups: MessageGroup[];
  backgroundTasks: LiveTask[];
  isStreaming: boolean;
  streamText: string;
  streamTools: SessionContentBlock[];
  processBusy: boolean;
  processRunning: boolean;
  sessionId: string | null;
  totalEntries: number;
  pendingCount: number;
  error: string | null | undefined;
  currentUserEmail: string | undefined;
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
  onVoiceSegmentSend: (text: string) => void;
  send: (event: { type: "DISMISS_ERROR" }) => void;
  /** Report user activity on the open companion card (scrolled/navigated/…). */
  reportCardActivity: (kind: ActivityKind, detail?: string) => void;
  /**
   * Native companion embed mode: keep the web conversation live, but suppress
   * the web input surface so the native shell can own composition.
   */
  embedded: boolean;
  /** Server-derived pending capture bubbles for this chat (Track 4). */
  captureBubbles: CaptureBubbleModel[];
  /** Retry a failed pending capture (re-seals its staging session). */
  onCaptureRetry: (id: string) => void;
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
}

function HeaderRegion(props: ChatBodyProps) {
  const { tabs, model, mute, voice, actions, effectiveContextDir, boxSlug, messages, sessionId, processRunning, isStreaming, debugView, setDebugView, showDebugLog, setShowDebugLog } = props;
  const { onZoomView } = tabs;
  const { selectedModel, narrationEnabled, handleToggleNarration, handleSelectModel } = model;
  return (
    <ChatHeader
      effectiveContextDir={effectiveContextDir}
      boxSlug={boxSlug}
      narrationEnabled={narrationEnabled}
      hqInFlight={voice.hqInFlight}
      onToggleNarration={handleToggleNarration}
      muted={mute.muted}
      onToggleMute={mute.handleToggleMute}
      messages={messages}
      onZoomView={onZoomView}
      onNewSession={actions.handleNewSession}
      debugMenu={
        <ChatDebugMenu
          onStopProcess={actions.handleStopProcess}
          onRestartProcess={actions.handleRestartProcess}
          onCompactSession={actions.handleCompactSession}
          sessionId={sessionId}
          running={processRunning}
          busy={isStreaming}
          debugView={debugView}
          onToggleDebugView={() => setDebugView((v) => !v)}
          showDebugLog={showDebugLog}
          onToggleDebugLog={() => setShowDebugLog((v) => !v)}
          selectedModel={selectedModel}
          onSelectModel={handleSelectModel}
          narrationEnabled={narrationEnabled}
          onToggleNarration={handleToggleNarration}
        />
      }
    />
  );
}

function MessageListRegion(props: ChatBodyProps) {
  const {
    tabs, model, voice, actions, messages, groups, modelMarkers, isStreaming, streamText, streamTools,
    processBusy, debugView, currentUserEmail, snapshot, totalEntries, loadingOlder, scrollToBottomTrigger, liveTurnId,
    effectiveContextDir, captureBubbles, onCaptureRetry,
  } = props;
  const { onZoomView } = tabs;
  const { speechPlayback, handleStopSpeech, handleSkipSpeech, handleReplaySpeech, pendingHqDraft } = voice;
  const { handleLoadOlder } = actions;
  return (
    <ChatContextDirProvider value={effectiveContextDir ?? undefined}>
    <MessageList
      messages={messages}
      groups={groups}
      modelMarkers={modelMarkers}
      isStreaming={isStreaming}
      streamText={streamText}
      streamTools={streamTools}
      processingShown={Boolean(processBusy) && !isStreaming}
      debugView={debugView}
      currentUserEmail={currentUserEmail}
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
      onCaptureRetry={onCaptureRetry}
    />
    </ChatContextDirProvider>
  );
}

function ComposerRegion(props: ChatBodyProps) {
  const {
    model, voice, recoveredDictation, expiredAttachmentsNotice, attach, selections, actions, isStreaming, processBusy, textareaRef,
    typingMode, setTypingMode, typingLocked, setTypingLocked, onVoiceSegmentSend, onEnterCapture, captureEnabled,
    captureDisabledReason,
  } = props;
  const { transcription, isTranscribing, voicePaused, stopDictation, clearDraft, handleCancelTranscription, startVoice, unpauseVoice } = voice;
  const { fileInputRef, removeAttachment, removeFileAttachment, handleAttachFiles, handleFileInputChange, addImageFiles } = attach;
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
          onAttachFiles={handleAttachFiles}
          addImageFiles={addImageFiles}
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
  const { tabs, voice, selections, schedules, error, pendingCount, isStreaming, processBusy, actions, showDebugLog, setShowDebugLog, send, embedded } = props;
  const { panel, activeView, onZoomView, onSelectTab, onCloseTab, onClosePanel } = tabs;
  const { addSelection } = selections;
  // Capture the live transcript phrase at grab-time so voice selections get a
  // positional anchor. Refs keep the handler identity stable while reading the
  // latest values at click time. Typed selections (not transcribing) pass a
  // null anchor → inline token instead.
  const transcriptRef = useRef("");
  const transcribingRef = useRef(false);
  useEffect(() => {
    transcriptRef.current = voice.transcription.transcript;
    transcribingRef.current = voice.isTranscribing;
  });
  const handleAddSelection = useCallback((selection: AddSelectionInput) => {
    if (!transcribingRef.current) {
      addSelection(selection, { anchor: null, spokenWords: null });
      return;
    }
    // Voice grab: capture the anchor phrase and how far into the utterance we
    // are (word count ≈ time), so a lost anchor still places by rough timing.
    const transcript = transcriptRef.current;
    addSelection(selection, { anchor: lastWords(transcript, 8), spokenWords: countWords(transcript) });
  }, [addSelection]);
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
            onNavigate={(target, hint) => {
              // A link followed within the pane is active consumption; the
              // detail is where they navigated to.
              props.reportCardActivity("navigated", target.path);
              onZoomView({
                target,
                label: hint && hint.label ? hint.label : target.path,
              });
            }}
            onAddSelection={handleAddSelection}
            reportActivity={props.reportCardActivity}
          />
        ) : null
      }
      header={embedded ? null : <HeaderRegion {...props} />}
      messageList={<MessageListRegion {...props} />}
      statusBanners={
        <>
          <BackgroundTasks tasks={props.backgroundTasks} />
          <ChatStatusBanners
            error={error}
            transcriptionError={voice.transcription.error}
            onDismissError={() => {
              send({ type: "DISMISS_ERROR" });
              voice.transcription.dismissError();
            }}
            activeSchedules={schedules.activeSchedules}
            onCancelSchedule={schedules.handleCancelSchedule}
          />
          <TargetStrip
            status={chatTargetStatus({ isStreaming, processBusy })}
            pendingCount={pendingCount}
            isStreaming={isStreaming}
            onInterrupt={actions.handleInterrupt}
            speechPlaying={voice.speechPlayback.isPlaying}
            onStopSpeech={voice.handleStopSpeech}
          />
        </>
      }
      composerSection={embedded ? null : <ComposerRegion {...props} />}
      debugLog={showDebugLog ? <DebugLogPanel onClose={() => setShowDebugLog(false)} /> : null}
    />
  );
}

/**
 * The props interface shared by `InteractiveChatBody` and its region
 * sub-components in `InteractiveChat-view.tsx` — pulled into its own module
 * so that file's line count doesn't have to compete with the JSX it renders.
 */

import type { ReactNode } from "react";
import type { ScreenshotRequestController } from "./screenshot-request-handler";
import type { LiveTask } from "./background-tasks";
import type { SessionEntry, SessionContentBlock } from "../../api";
import type { MessageGroup } from "./ChatMessages";
import type { ModelMarker, VoiceSegmentSend } from "./InteractiveChat-helpers";
import type { useChatTabs, useChatMute, useChatSchedules } from "./InteractiveChat-hooks";
import type { useChatModelFeatures } from "./use-chat-model";
import type { useChatVoice } from "./InteractiveChat-voice";
import type { useChatAttachments } from "./InteractiveChat-attachments";
import type { useChatSelections } from "./InteractiveChat-selections";
import type { useChatActions } from "./InteractiveChat-actions";
import type { ActivityKind } from "@core/chat/card-activity.js";
import type { CaptureBubbleModel, CaptureVerbs } from "./capture-bubble";
import type { AudioOverlayStore } from "./audio-overlay-store";

export interface ChatBodyProps {
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
  sendSignal: number;
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

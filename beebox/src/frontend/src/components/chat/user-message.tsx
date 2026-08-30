/**
 * User-side chat rendering: the message bubble, inline images, file-attachment
 * chips, ack badges, task-notification markers, and the keyword-pill text.
 */

import { useState } from "react";
import { invariant } from "@shared/invariant";
import { Pre } from "../ui/Pre";
import { getApiBase } from "../../api";
import type { SessionEntry } from "../../api";
import type { AckIndication } from "../../lib/structured-output-parsing";
import type { OnZoomView } from "./markdown-rendering";
import { AckBadgeCluster } from "./ack-badge";
import { AudioOverlayBadgeCluster, TranscriptionProvenanceBadge } from "./audio-overlay-badge";
import { useAudioOverlayEntry, type AudioOverlayStore } from "./audio-overlay-store";
import {
  extractFileAttachments,
  getUserName,
  parseTaskNotification,
  resolveEntryMessageId,
  resolveTranscriptionProvenance,
  stripUserDisplayTags,
  type TaskNotification,
} from "./message-parsing";
import { UserEntryContent, originalDisplayText } from "./user-entry-content";
import { isOtherChatUser } from "./chat-message-sender";

/**
 * Map a settled task's status to its dot color and an optional label. The SDK's
 * terminal statuses are `completed | failed | stopped | killed` ("error" is
 * never emitted); anything non-success gets the danger color and a short label
 * so a failed background task is visually distinct from a successful one.
 */
function taskStatusStyle(status: string): { color: string; label: string | null } {
  switch (status) {
    case "completed":
      return { color: "text-success", label: null };
    case "failed":
    case "stopped":
    case "killed":
      return { color: "text-danger-dark", label: status };
    case "running":
    case "pending":
    case "paused":
      return { color: "text-info", label: status };
    default:
      return { color: "text-warm-600", label: null };
  }
}

function TaskNotificationMessage({ notification }: { notification: TaskNotification }) {
  const [expanded, setExpanded] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [loadingOutput, setLoadingOutput] = useState(false);
  const { color: statusColor, label: statusLabel } = taskStatusStyle(notification.status);

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && output === null && notification.outputFile) {
      setLoadingOutput(true);
      fetch(`${getApiBase()}/task-output?file=${encodeURIComponent(notification.outputFile)}`)
        .then((res) => {
          if (res.ok) return res.text();
          return null;
        })
        .then((text) => {
          setOutput(text ?? "(output no longer available)");
          setLoadingOutput(false);
        })
        .catch(() => {
          setOutput("(failed to load output)");
          setLoadingOutput(false);
        });
    }
  };

  return (
    <div className="py-1">
      <div className="flex justify-center">
        <button
          onClick={handleExpand}
          className="text-xs text-warm-500 hover:text-warm-700 bg-warm-50 rounded-full px-3 py-1 flex items-center gap-1.5"
        >
          <span className={statusColor}>&#x25CF;</span>
          {statusLabel ? <span className={`font-medium ${statusColor}`}>{statusLabel}:</span> : null}
          {notification.summary}
          <span className="text-warm-400">{expanded ? "▾" : "▸"}</span>
        </button>
      </div>
      {expanded ? (
        <div className="mx-4 mt-2 bg-warm-50 border border-warm-200 rounded-lg p-3 text-xs">
          {loadingOutput ? (
            <div className="text-warm-500 italic">Loading output...</div>
          ) : output ? (
            <Pre size="xs" scroll="md">{output}</Pre>
          ) : (
            <div className="text-warm-500 italic">No output file</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Render a user message bubble.
 * When currentUserEmail is provided, messages from other users are styled differently.
 */
export function UserMessage({ entries, debugView, currentUserEmail, currentUserName, acks, onZoomView, audioOverlayStore }: {
  entries: SessionEntry[];
  debugView?: boolean;
  currentUserEmail?: string;
  currentUserName?: string;
  acks?: AckIndication[];
  onZoomView?: OnZoomView;
  /** Overlay store for retranscription/consulted badges (Track 3); undefined where no chat is wired to one (e.g. the dev harness). */
  audioOverlayStore?: AudioOverlayStore;
}) {
  // A hook, so it must run unconditionally — before the early returns below.
  // `entries` is never empty in practice (see the invariant further down),
  // but the hook can't wait for that check to run.
  const audioResolvedKey = entries[0] ? resolveEntryMessageId(entries[0]) : null;
  const audioOverlay = useAudioOverlayEntry(audioOverlayStore, audioResolvedKey);

  const allTexts = entries.flatMap((e) =>
    e.content.filter((b) => b.type === "text").map((b) => b.text ?? "")
  );
  const hasImages = entries.some((e) => e.content.some((b) => b.type === "image"));
  const allFileIds = new Set(allTexts.flatMap((t) => extractFileAttachments(t).map((r) => r.id)));
  const hasFiles = allFileIds.size > 0;

  // Hide schedule-fired messages entirely in normal view (they're system-injected)
  if (!debugView) {
    const allEmpty = allTexts.every((t) => stripUserDisplayTags(t, { attachedFileIds: allFileIds }).trim() === "");
    if (allEmpty && !hasImages && !hasFiles) return null;
  }

  // Show task-notification messages as collapsed system info — but only when
  // there's something to report. A background command that finished cleanly
  // ("completed", exit 0) is a non-event; success doesn't need noting, so we
  // render nothing and keep the transcript quiet. Only non-success terminal
  // states (failed/stopped/killed) get a marker. (Debug view still shows the
  // raw text via the normal path below, so nothing is lost for inspection.)
  const taskNotification = parseTaskNotification(allTexts.join("\n"));
  if (taskNotification && !debugView) {
    if (taskNotification.status === "completed") return null;
    return <TaskNotificationMessage notification={taskNotification} />;
  }

  const firstEntry = entries[0];
  invariant(firstEntry !== undefined, "user message group has no entries");
  const senderName = getUserName(firstEntry);
  const senderEmail = firstEntry.userEmail;
  const transcriptionProvenance = resolveTranscriptionProvenance(firstEntry);
  // Compare by email if available (same user across devices), fall back to name
  const isOtherUser = isOtherChatUser({
    locallyAuthored: firstEntry.reconcileKnownUuids !== undefined,
    senderEmail,
    senderName,
    currentUserEmail,
    currentUserName,
  });

  const isPending = entries.every((e) => e.pending === true);
  const pendingClass = isPending ? " opacity-60" : "";
  const pendingTitle = isPending ? "Queued — waiting for agent" : undefined;

  if (isOtherUser) {
    // Other user's message: left-aligned with name label. Fix (2026-08,
    // cross-model review): in a shared session, another user's retranscribed
    // message must update on THIS viewer's screen too — the overlay isn't
    // scoped to the sender. Ack badges stay absent here by the existing
    // deliberate design (this branch never threaded `acks` through); the
    // audio-overlay cluster still goes on, matching the bubble's own
    // white-on-`bg-primary` palette (same muted convention as the own-message
    // bubble's `bg-info`).
    return (
      <div className="pr-12 sm:pr-24 py-1">
        <div className="text-xs text-warm-500 ml-3 sm:ml-6 mb-0.5">{senderName}</div>
        <div className="relative ml-3 sm:ml-6 w-fit">
          <span className="absolute -top-1 -left-1 inline-flex items-center gap-0.5">
            <AudioOverlayBadgeCluster overlay={audioOverlay} originalText={originalDisplayText(firstEntry)} />
          </span>
          <span className="absolute top-px right-px z-10">
            <TranscriptionProvenanceBadge provenance={transcriptionProvenance} />
          </span>
          <div
            className={"rounded-r-2xl bg-primary text-white px-3 sm:px-4 py-2 min-w-[80px] sm:min-w-[120px] w-fit break-words" + pendingClass}
            title={pendingTitle}
          >
            {entries.map((entry) => (
              <UserEntryContent
                key={entry.uuid}
                entry={entry}
                debugView={debugView ?? false}
                audioOverlay={audioOverlay}
                matchesOverlay={entry.uuid === firstEntry.uuid}
              />
            ))}
            {isPending ? <PendingIndicator /> : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-end pl-12 sm:pl-24 py-1">
      {/* min-w-0 lets this flex item shrink below its content's intrinsic
          width, so break-words can wrap a long unbreakable string (e.g. a URL)
          instead of the bubble overflowing the row. */}
      <div className="relative min-w-0">
        {/* Shared corner row: ack badges keep precedence order, audio
            badges append after (docs/implemented-plans/retranscription-in-chat.md
            Track 3, "badge rendering"). */}
        <span className="absolute -top-1 -left-1 inline-flex items-center gap-0.5">
          <AckBadgeCluster acks={acks} onZoomView={onZoomView} />
          <AudioOverlayBadgeCluster overlay={audioOverlay} originalText={originalDisplayText(firstEntry)} />
        </span>
        <span className="absolute top-px right-px z-10">
          <TranscriptionProvenanceBadge provenance={transcriptionProvenance} />
        </span>
        <div
          className={"rounded-l-2xl bg-info text-white px-3 sm:px-4 py-2 min-w-[80px] sm:min-w-[120px] break-words" + pendingClass}
          title={pendingTitle}
        >
          {entries.map((entry) => (
            <UserEntryContent
              key={entry.uuid}
              entry={entry}
              debugView={debugView ?? false}
              audioOverlay={audioOverlay}
              matchesOverlay={entry.uuid === firstEntry.uuid}
            />
          ))}
          {isPending ? <PendingIndicator /> : null}
        </div>
      </div>
    </div>
  );
}

function PendingIndicator() {
  return (
    <div className="text-xs text-white/70 mt-1 italic">queued — waiting</div>
  );
}

/**
 * User-side chat rendering: the message bubble, inline images, file-attachment
 * chips, ack badges, task-notification markers, and the keyword-pill text.
 */

import { useState } from "react";
import { assertNever, invariant } from "@shared/invariant";
import {
  parseDeliveredUserMessageParts,
  type DeliveredUserMessagePart,
} from "@shared/delivered-user-message";
import { Image } from "../ui/Image";
import { Pre } from "../ui/Pre";
import { getApiBase } from "../../api";
import type { SessionEntry } from "../../api";
import type { AckIndication } from "../../lib/structured-output-parsing";
import type { OnZoomView } from "./markdown-rendering";
import { AckBadgeCluster } from "./ack-badge";
import {
  extractFileAttachments,
  getUserName,
  imageBlockSrc,
  parseTaskNotification,
  stripUserDisplayTags,
  type TaskNotification,
} from "./message-parsing";
import { CaptureChip } from "./CaptureChip";
import { UploadChip } from "./UploadChip";
import { UserMessageText } from "./user-message-text";

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
 * Thumbnail + lightbox for an inline image in a user message bubble.
 */
function MessageImage({ src, alt }: { src: string; alt: string }) {
  return <Image src={src} alt={alt} size="sm" lightbox bordered className="my-1" />;
}

/**
 * Inline chip showing an attached file with its original name. The path
 * sits in <boxRoot>/tmp/, gitignored and swept by housekeeping; we don't
 * link it because the chip is just a "you sent this" affordance.
 */
function MessageFileChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-warm-100 border border-warm-300 text-xs text-warm-800">
      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span className="truncate max-w-[16rem]">{name}</span>
    </span>
  );
}

function DeliveredMessagePart({ part }: { part: DeliveredUserMessagePart }) {
  switch (part.kind) {
    case "text":
      if (stripUserDisplayTags(part.text).trim() === "") return null;
      return (
        <div className="text-sm whitespace-pre-wrap">
          <UserMessageText text={part.text} />
        </div>
      );
    case "capture":
      return <CaptureChip model={part} />;
    case "upload":
      return <UploadChip model={part} />;
    default:
      return assertNever(part);
  }
}

function DeliveredMessageParts({ text }: { text: string }) {
  const parts = parseDeliveredUserMessageParts(text);
  return (
    <>
      {parts.map((part, index) => (
        <DeliveredMessagePart key={`${part.kind}-${String(index)}`} part={part} />
      ))}
    </>
  );
}

/**
 * Render a user entry's content blocks: text blocks go through the normal
 * tag-stripping display, image blocks render as clickable thumbnails. File
 * attachments parsed from a sibling <attachments> block render as chips.
 */
function UserEntryContent({ entry, debugView }: { entry: SessionEntry; debugView: boolean }) {
  const fileRefs = entry.content
    .filter((b) => b.type === "text")
    .flatMap((b) => extractFileAttachments(b.text ?? ""));
  return (
    <>
      {entry.content.map((block, i) => {
        const key = `${entry.uuid}-${i}`;
        if (block.type === "text") {
          if (debugView) {
            return (
              <Pre key={key} size="xs">{block.text ?? ""}</Pre>
            );
          }
          return <DeliveredMessageParts key={key} text={block.text ?? ""} />;
        }
        if (block.type === "image") {
          const src = imageBlockSrc(block);
          if (!src) return null;
          return <MessageImage key={key} src={src} alt={`Attached image ${i + 1}`} />;
        }
        return null;
      })}
      {!debugView && fileRefs.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {fileRefs.map((f) => (
            <MessageFileChip key={f.id} name={f.displayName} />
          ))}
        </div>
      ) : null}
    </>
  );
}

/**
 * Render a user message bubble.
 * When currentUserEmail is provided, messages from other users are styled differently.
 */
export function UserMessage({ entries, debugView, currentUserEmail, acks, onZoomView }: { entries: SessionEntry[]; debugView?: boolean; currentUserEmail?: string; acks?: AckIndication[]; onZoomView?: OnZoomView }) {
  const allTexts = entries.flatMap((e) =>
    e.content.filter((b) => b.type === "text").map((b) => b.text ?? "")
  );
  const hasImages = entries.some((e) => e.content.some((b) => b.type === "image"));
  const hasFiles = allTexts.some((t) => extractFileAttachments(t).length > 0);

  // Hide schedule-fired messages entirely in normal view (they're system-injected)
  if (!debugView) {
    const allEmpty = allTexts.every((t) => stripUserDisplayTags(t).trim() === "");
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
  // Compare by email if available (same user across devices), fall back to name
  const isOtherUser = currentUserEmail
    ? senderEmail ? senderEmail !== currentUserEmail : senderName ? senderName !== currentUserEmail : false
    : false;

  const isPending = entries.every((e) => e.pending === true);
  const pendingClass = isPending ? " opacity-60" : "";
  const pendingTitle = isPending ? "Queued — waiting for agent" : undefined;

  if (isOtherUser) {
    // Other user's message: left-aligned with name label
    return (
      <div className="pr-12 sm:pr-24 py-1">
        <div className="text-xs text-warm-500 ml-3 sm:ml-6 mb-0.5">{senderName}</div>
        <div
          className={"ml-3 sm:ml-6 rounded-r-2xl bg-primary text-white px-3 sm:px-4 py-2 min-w-[80px] sm:min-w-[120px] w-fit break-words" + pendingClass}
          title={pendingTitle}
        >
          {entries.map((entry) => (
            <UserEntryContent key={entry.uuid} entry={entry} debugView={debugView ?? false} />
          ))}
          {isPending ? <PendingIndicator /> : null}
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
        <AckBadgeCluster acks={acks} onZoomView={onZoomView} />
        <div
          className={"rounded-l-2xl bg-info text-white px-3 sm:px-4 py-2 min-w-[80px] sm:min-w-[120px] break-words" + pendingClass}
          title={pendingTitle}
        >
          {entries.map((entry) => (
            <UserEntryContent key={entry.uuid} entry={entry} debugView={debugView ?? false} />
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

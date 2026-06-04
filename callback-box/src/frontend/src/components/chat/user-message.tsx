/**
 * User-side chat rendering: the message bubble, inline images, file-attachment
 * chips, ack badges, task-notification markers, and the keyword-pill text.
 */

import { useState } from "react";
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

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&");
}

const REF_ATTR_RE = /\bref="([^"]*)"/i;
const POSITION_ATTR_RE = /\bpos="([^"]*)"/i;
const PLACEMENT_ATTR_RE = /\bplacement="([^"]*)"/i;

function readAttr(attrs: string, re: RegExp): string {
  const match = re.exec(attrs);
  return match ? decodeXml(match[1]) : "";
}

function docBasename(ref: string): string {
  const base = ref.split("/").pop();
  if (base === undefined || base === "") return ref;
  return base.endsWith(".card") ? base.slice(0, -5) : base;
}

function snippet(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

/** Pill shown in a sent user message for an attached document selection. */
function MessageSelectionPill({ text, sourceRef, position, placement }: { text: string; sourceRef: string; position: string; placement: string }) {
  const titleParts = [`"${text}"`, docBasename(sourceRef)];
  if (position !== "") titleParts.push(position);
  if (placement !== "") titleParts.push(placement);
  return (
    <span
      className="inline-flex items-center gap-1 bg-white/20 rounded-full px-2 py-0.5 text-xs font-medium align-baseline"
      title={titleParts.join(" — ")}
    >
      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h4m3 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span className="truncate max-w-[12rem]">{snippet(text, 32)}</span>
    </span>
  );
}

type MessagePart =
  | { type: "text"; value: string }
  | { type: "send"; phrase: string }
  | { type: "selection"; text: string; sourceRef: string; position: string; placement: string };

export function UserMessageText({ text }: { text: string }) {
  const stripped = stripUserDisplayTags(text);

  const parts: MessagePart[] = [];
  // Pills: <send-message phrase="…"/> (voice keyword) and <user-selection
  // ref="…" pos="…">quoted text</user-selection> (attached document text).
  const tagRe = /<send-message\s+phrase="([^"]*?)"\s*\/>|<user-selection\b([^>]*)>([\S\s]*?)<\/user-selection>/gi;
  let lastIndex = 0;
  let match;
  while ((match = tagRe.exec(stripped)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: stripped.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      parts.push({ type: "send", phrase: match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&") });
    } else {
      const attrs = match[2] ?? "";
      parts.push({
        type: "selection",
        text: decodeXml(match[3] ?? ""),
        sourceRef: readAttr(attrs, REF_ATTR_RE),
        position: readAttr(attrs, POSITION_ATTR_RE),
        placement: readAttr(attrs, PLACEMENT_ATTR_RE),
      });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < stripped.length) {
    parts.push({ type: "text", value: stripped.slice(lastIndex) });
  }

  const hasPill = parts.some((p) => p.type !== "text");
  if (!hasPill) {
    return <>{stripped.trim()}</>;
  }

  return (
    <>
      {parts.map((p, i) => {
        if (p.type === "text") {
          return <span key={i}>{p.value}</span>;
        }
        if (p.type === "selection") {
          return <MessageSelectionPill key={i} text={p.text} sourceRef={p.sourceRef} position={p.position} placement={p.placement} />;
        }
        return (
          <span key={i} className="inline-flex items-center gap-1 bg-white/20 rounded-full px-2 py-0.5 text-xs font-medium">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
            {p.phrase}
          </span>
        );
      })}
    </>
  );
}

function TaskNotificationMessage({ notification }: { notification: TaskNotification }) {
  const [expanded, setExpanded] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [loadingOutput, setLoadingOutput] = useState(false);
  const statusColor = notification.status === "completed"
    ? "text-success"
    : notification.status === "error" ? "text-danger-dark" : "text-warm-600";

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
          return (
            <div key={key} className="text-sm whitespace-pre-wrap">
              <UserMessageText text={block.text ?? ""} />
            </div>
          );
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

  // Show task-notification messages as collapsed system info
  const taskNotification = parseTaskNotification(allTexts.join("\n"));
  if (taskNotification && !debugView) {
    return <TaskNotificationMessage notification={taskNotification} />;
  }

  const senderName = getUserName(entries[0]);
  const senderEmail = entries[0].userEmail;
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
      <div className="relative">
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

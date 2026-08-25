/**
 * Rendering for a single user-message entry's content blocks: text (with
 * capture/upload chip splitting and the audio-overlay text swap), inline
 * images, and file-attachment chips. Split out of user-message.tsx to keep
 * that file under the line limit — the same reasoning as
 * `user-message-text.tsx`.
 */

import { assertNever } from "@shared/invariant";
import {
  parseDeliveredUserMessageParts,
  type DeliveredUserMessagePart,
} from "@shared/delivered-user-message";
import { Image } from "../ui/Image";
import { Pre } from "../ui/Pre";
import type { SessionEntry } from "../../api";
import type { AudioOverlayEntry } from "./audio-overlay-store";
import { extractFileAttachments, imageBlockSrc, stripUserDisplayTags } from "./message-parsing";
import { CaptureChip } from "./CaptureChip";
import { UploadChip } from "./UploadChip";
import { UserMessageText } from "./user-message-text";

/**
 * Thumbnail + lightbox for an inline image in a user message bubble.
 *
 * Lazy on purpose. A photo that stayed in the transcript is fetched per image
 * (`shared/session-media.ts`), so an old conversation full of them would
 * otherwise fire a request per photo the moment its history arrived. `lazy`
 * defers each one until it is near the viewport, which means scrolling back
 * costs a photo at a time and the ones never reached cost nothing.
 */
function MessageImage({ src, alt }: { src: string; alt: string }) {
  return <Image src={src} alt={alt} size="sm" lightbox bordered className="my-1" loading="lazy" />;
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

function DeliveredMessagePart({ part, attachedFileIds }: { part: DeliveredUserMessagePart; attachedFileIds: ReadonlySet<number> }) {
  switch (part.kind) {
    case "text":
      if (stripUserDisplayTags(part.text, { attachedFileIds }).trim() === "") return null;
      return (
        <div className="text-sm whitespace-pre-wrap">
          <UserMessageText text={part.text} attachedFileIds={attachedFileIds} />
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

function DeliveredMessageParts({ text, attachedFileIds }: { text: string; attachedFileIds: ReadonlySet<number> }) {
  const parts = parseDeliveredUserMessageParts(text);
  return (
    <>
      {parts.map((part, index) => (
        <DeliveredMessagePart key={`${part.kind}-${String(index)}`} part={part} attachedFileIds={attachedFileIds} />
      ))}
    </>
  );
}

/**
 * Render a user entry's content blocks: text blocks go through the normal
 * tag-stripping display, image blocks render as clickable thumbnails. File
 * attachments parsed from a sibling <attachments> block render as chips.
 *
 * `audioOverlay`, when its `retranscription` is set AND `matchesOverlay` is
 * true, swaps ONLY the string handed to `DeliveredMessageParts`/
 * `UserMessageText` for text blocks — file refs, images, and the debug view
 * all keep deriving from the block's ORIGINAL text
 * (docs/implemented-plans/retranscription-in-chat.md Track 3, "replacement is scoped to
 * the display text only").
 */
export function UserEntryContent({ entry, debugView, audioOverlay, matchesOverlay }: {
  entry: SessionEntry;
  debugView: boolean;
  audioOverlay?: AudioOverlayEntry | undefined;
  matchesOverlay?: boolean;
}) {
  const fileRefs = entry.content
    .filter((b) => b.type === "text")
    .flatMap((b) => extractFileAttachments(b.text ?? ""));
  // Entry-level, not per-block: `[imageN]` expansion splits a sent message
  // into several text blocks, and a file token can sit in an earlier block
  // than the `<attachments>` declaration it resolves through.
  const attachedFileIds = new Set(fileRefs.map((f) => f.id));
  const retranscription = matchesOverlay ? audioOverlay?.retranscription : undefined;
  return (
    <>
      {entry.content.map((block, i) => {
        const key = `${entry.uuid}-${i}`;
        if (block.type === "text") {
          const originalText = block.text ?? "";
          if (debugView) {
            return (
              <Pre key={key} size="xs">{originalText}</Pre>
            );
          }
          // Diarized replacement text has no pill/mark vocabulary of its own —
          // it renders through the same UserMessageText path, falling through
          // to its plain-text branch (still whitespace-pre-wrap via the
          // wrapping div in DeliveredMessagePart).
          const displayText = retranscription ? retranscription.newText : originalText;
          return <DeliveredMessageParts key={key} text={displayText} attachedFileIds={attachedFileIds} />;
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

// Same unwrap `stripSpeechWrappers` does backend-side (`src/cli/lib/session-text.ts`)
// for a low-confidence-word mark (Track 4, docs/plans/transcript-confidence.md):
// the popover wants clean human text, not the agent-facing `<unsure>` marker.
// `stripUserDisplayTags` only strips the `<speech>`/`<typed>` SHELL — an inner
// mark like `<unsure>` deliberately survives it (see that function's doc) so
// `UserMessageText` can render it with its dotted-underline styling in the
// normal bubble path; the popover has no such styling pass, so it unwraps to
// the bare word instead of leaking the raw tag.
const UNSURE_MARK_RE = /<\/?unsure\b[^>]*>/g;

/** The entry's original (never-overlaid) text, stripped for the popover's "realtime transcript" body. */
export function originalDisplayText(entry: SessionEntry): string {
  const fileRefs = entry.content
    .filter((b) => b.type === "text")
    .flatMap((b) => extractFileAttachments(b.text ?? ""));
  const attachedFileIds = new Set(fileRefs.map((f) => f.id));
  return entry.content
    .filter((b) => b.type === "text")
    .map((b) => stripUserDisplayTags(b.text ?? "", { attachedFileIds }).replace(UNSURE_MARK_RE, ""))
    .join("\n")
    .trim();
}

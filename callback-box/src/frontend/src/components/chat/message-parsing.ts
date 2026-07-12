/**
 * Pure parsing helpers for chat message rendering: self-notes, attachments,
 * tag stripping, message grouping, and image extraction. No JSX lives here —
 * the rendering components in ChatMessages.tsx and its siblings consume these.
 */

import type { LightboxImage } from "../ImageLightbox";
import { isExternalUrl, resolveImageSrc } from "../../lib/view-url";
import { bustImageSrc } from "../../lib/file-version";
import type { SessionEntry, SessionContentBlock } from "../../api";
import { stripChatAppTags } from "@shared/chat-tags";
import { entrySelfNotes, type SelfNoteInfo } from "@shared/self-note";

// Self-note parsing is shared with the CLI/webapp — see `core/self-note.ts`.
// Re-exported so ChatMessages.tsx keeps importing the type from this module.
export type { SelfNoteInfo };

/**
 * Strip system-injected tags from user message text for display.
 */
export function stripUserDisplayTags(text: string): string {
  return stripChatAppTags(text)
    .replace(/<typed[^>]*>/gi, "")
    .replace(/<\/typed>/gi, "")
    .replace(/<speech[^>]*>/gi, "")
    .replace(/<\/speech>/gi, "")
    .replace(/<pending-schedules>[\S\s]*?<\/pending-schedules>/gi, "")
    .replace(/<schedule-fired[\S\s]*?<\/schedule-fired>/gi, "")
    .replace(/<attachments>[\S\s]*?<\/attachments>/gi, "");
}

/**
 * Extract file attachments from a user message's text. Looks for the
 * `<attachments>` block written by the chat composer and parses
 * `[fileN]: tmp/<timestamp>_<original-name>` reference lines.
 */
export interface FileAttachmentRef {
  id: number;
  path: string;
  /** Best-effort original filename, recovered by stripping the timestamp prefix. */
  displayName: string;
}

const ATTACHMENTS_BLOCK_RE = /<attachments>([\S\s]*?)<\/attachments>/i;
const FILE_REF_LINE_RE = /\[file(\d+)]:\s*(\S+)/g;
const TMP_FILENAME_PREFIX_RE = /^tmp\/[^/_]+_(.+)$/;

export function extractFileAttachments(text: string): FileAttachmentRef[] {
  const inner = text.match(ATTACHMENTS_BLOCK_RE)?.[1];
  if (inner === undefined) return [];
  const refs: FileAttachmentRef[] = [];
  for (const m of inner.matchAll(FILE_REF_LINE_RE)) {
    const idStr = m[1];
    const p = m[2];
    if (idStr === undefined || p === undefined) continue;
    const stripped = p.match(TMP_FILENAME_PREFIX_RE)?.[1];
    refs.push({
      id: parseInt(idStr, 10),
      path: p,
      displayName: stripped ?? p,
    });
  }
  return refs;
}

/**
 * Extract user name from a session entry.
 * Checks the entry's user field first, then parses from tag attributes.
 */
export function getUserName(entry: SessionEntry): string | null {
  if (entry.user) return entry.user;
  const firstText = entry.content.find((b) => b.type === "text")?.text || "";
  const match = firstText.match(/<(?:typed|speech)\b[^>]*\buser="([^"]*)"/);
  const user = match?.[1];
  if (user !== undefined) return user.replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
  return null;
}

/**
 * Strip speech tags and instructions from assistant content for markdown rendering.
 *
 * Handles partial-streaming cases as well: an opened-but-not-yet-closed
 * `<instructions>` or `<schedule>` body is stripped through end-of-text,
 * and a trailing incomplete tag like `<spee` or `</instr` is hidden so
 * we don't flicker raw markup for a frame as deltas arrive.
 */
export function stripSpeechTags(content: string): string {
  // Closed forms first.
  let result = content.replace(/<instructions>[\S\s]*?<\/instructions>/gi, "");
  result = result.replace(/<schedule[\S\s]*?<\/schedule>/gi, "");
  result = result.replace(/<speech[^>]*>/gi, "");
  result = result.replace(/<\/speech>/gi, "");
  result = result.replace(/<cancel-schedule[^>]*>/gi, "");
  // Streaming: unclosed instructions/schedule body — drop from the opening
  // tag through end-of-text. Safe on finalized text (no unclosed tags
  // expected there).
  result = result.replace(/<instructions>[\S\s]*$/i, "");
  result = result.replace(/<schedule\b[\S\s]*$/i, "");
  // Streaming: a trailing incomplete tag like `<spee` or `</instr` whose
  // closing `>` hasn't arrived yet. Match `<` (optionally with `/`)
  // followed by tag-name chars to end-of-string. The `[^<>]*` body keeps
  // a dangling `<a href="x` from leaking. Safe for `2 < 3` (no letter
  // after the `<`).
  result = result.replace(/<\/?[a-z][^<>]*$/i, "");
  return result.trim();
}

/**
 * One displayed item in the chat transcript.
 *
 * User entries are never merged — each send is its own bubble, so the
 * queued-message UI stays unambiguous. Assistant entries DO merge with
 * their immediate predecessor, because tool/thinking folding
 * (`groupIntoParts` → `ActivityGroup`) only works within a single
 * AssistantMessage. Without merging, every tool call shows as its own
 * unfoldable line.
 *
 * Self-note groups still carry their parsed `notes` payload alongside the
 * entry. Local-command entries are filtered out entirely (see below).
 */
export type MessageGroup =
  | { type: "user" | "assistant" | "compaction" | "interrupted"; entries: SessionEntry[] }
  | { type: "self-note"; entries: SessionEntry[]; notes: SelfNoteInfo[] };

/**
 * Local-command entries are injected by the Claude CLI when slash commands
 * like /model or /compact run via stream-json. They appear as user-type
 * entries whose text is a bare `<local-command-caveat>`, `<command-name>`,
 * or `<local-command-stdout>` tag. We skip them in the rendered chat because
 * they clutter the transcript and say nothing the user cares about — the
 * relevant UI affordance (pill, compaction marker) is surfaced separately.
 */
function isLocalCommandEntry(entry: SessionEntry): boolean {
  if (entry.type !== "user") return false;
  const texts = entry.content.filter((b) => b.type === "text").map((b) => (b.text ?? "").trim());
  if (texts.length === 0) return false;
  return texts.every((t) =>
    t.startsWith("<local-command-caveat>") ||
    t.startsWith("<local-command-stdout>") ||
    t.startsWith("<command-name>"),
  );
}

export function groupMessages(entries: SessionEntry[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const entry of entries) {
    if (isLocalCommandEntry(entry)) continue;
    if (entry.type === "compaction") {
      groups.push({ type: "compaction", entries: [entry] });
      continue;
    }
    if (entry.type === "interrupted") {
      groups.push({ type: "interrupted", entries: [entry] });
      continue;
    }
    const notes = entrySelfNotes(entry);
    if (notes) {
      groups.push({ type: "self-note", entries: [entry], notes });
      continue;
    }
    if (entry.type === "assistant") {
      // `.at(-1)`: its return type is honestly `T | undefined` (a plain
      // index read would type as always-defined without
      // `noUncheckedIndexedAccess`, which the frontend tsconfig lacks).
      const last = groups.at(-1);
      if (last && last.type === "assistant") {
        last.entries.push(entry);
        continue;
      }
    }
    groups.push({ type: entry.type, entries: [entry] });
  }
  return groups;
}

// --- Task notification handling ---

export interface TaskNotification {
  taskId: string;
  status: string;
  summary: string;
  outputFile?: string;
}

export function parseTaskNotification(text: string): TaskNotification | null {
  const match = text.match(/<task-notification>[\S\s]*?<task-id>([^<]*)<\/task-id>[\S\s]*?<status>([^<]*)<\/status>[\S\s]*?<summary>([^<]*)<\/summary>[\S\s]*?<\/task-notification>/);
  if (!match) return null;
  const outputMatch = text.match(/<output-file>([^<]*)<\/output-file>/);
  // No group in the pattern is optional/alternated, so a successful overall
  // match guarantees every capture participated (possibly as ""); the `?? ""`
  // fallbacks are unreachable in practice but honest to the regex-match type.
  const [, taskId = "", status = "", summary = ""] = match;
  return {
    taskId,
    status,
    summary,
    outputFile: outputMatch?.[1],
  };
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"]);

export function isImagePath(path: string): boolean {
  // Strip any ?query / #hash before checking the extension, so a cache-busted
  // image (`photo.png?v=1`) is still recognized as an image, not an embed.
  const [clean = ""] = path.split(/[#?]/, 1);
  const dot = clean.lastIndexOf(".");
  if (dot <= 0) return false;
  return IMAGE_EXTS.has(clean.slice(dot).toLowerCase());
}

/**
 * Resolve an image block's source into a browser-usable URL.
 * Returns null if neither base64 data nor a URL is present.
 */
export function imageBlockSrc(block: SessionContentBlock): string | null {
  if (block.dataBase64 && block.mediaType) {
    return `data:${block.mediaType};base64,${block.dataBase64}`;
  }
  if (block.imageUrl) return block.imageUrl;
  return null;
}

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)]\(([^\s)]+)(?:\s+"[^"]*")?\)/g;

function extractImagesFromMarkdown(
  text: string,
  { out, boxSlug }: { out: LightboxImage[]; boxSlug: string | undefined },
): void {
  for (const match of text.matchAll(MARKDOWN_IMAGE_RE)) {
    const alt = match[1] ?? "";
    const rawSrc = match[2];
    // `![…](…)` is the embed syntax: an image src belongs in the lightbox, but a
    // card/file embed (an in-box, non-image path) does not — skip it.
    if (rawSrc && (isExternalUrl(rawSrc) || isImagePath(rawSrc))) {
      const src = bustImageSrc(resolveImageSrc(rawSrc, { boxSlug, basePath: undefined }));
      const trimmedAlt = alt.trim();
      out.push({
        src,
        alt,
        caption: trimmedAlt === "" ? undefined : alt,
      });
    }
  }
}

/**
 * Extract every image referenced in a chat — image content blocks plus
 * markdown `![](url)` and `view:` image links inside text blocks. The
 * result is the canonical, in-order list used by the lightbox so that
 * navigation works for messages that aren't currently mounted by the
 * virtualizer. Optional `streamText` appends still-streaming images so
 * the list stays accurate while a turn is in flight.
 */
export function extractChatImages(
  entries: SessionEntry[],
  { streamText, boxSlug }: { streamText: string | undefined; boxSlug: string | undefined },
): LightboxImage[] {
  const images: LightboxImage[] = [];
  let attachmentIndex = 0;
  for (const entry of entries) {
    for (const block of entry.content) {
      if (block.type === "image") {
        const src = imageBlockSrc(block);
        if (src) {
          attachmentIndex += 1;
          images.push({ src, alt: `Attached image ${attachmentIndex}` });
        }
      } else if (block.type === "text" && block.text) {
        extractImagesFromMarkdown(block.text, { out: images, boxSlug });
      }
    }
  }
  if (streamText) extractImagesFromMarkdown(streamText, { out: images, boxSlug });
  return images;
}

// --- Assistant part grouping ---

// A discriminated union on `type`: text/thinking parts carry `text`, a tools
// part carries `tools`. Each variant holds exactly the field its kind
// populates, so a consumer that narrows on `type` sees only the fields that
// exist — no optional-field guards or runtime `invariant`s needed.
type AssistantPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text?: string }
  | { type: "tools"; tools: SessionContentBlock[] };
export interface TextGroup { kind: "text"; text: string }
/** The non-text members of AssistantPart — what an activity group renders. */
export type ActivityPart =
  | { type: "thinking"; text?: string }
  | { type: "tools"; tools: SessionContentBlock[] };
export interface ActivityGroupData { kind: "activity"; parts: ActivityPart[] }

// Narrows off the `type` discriminant: everything that isn't "text" is an
// ActivityPart (thinking or tools).
function isActivityPart(part: AssistantPart): part is ActivityPart {
  return part.type !== "text";
}

/**
 * Group consecutive non-text parts (thinking, tools) into activity groups,
 * separated by text parts which render as normal markdown.
 */
export function groupIntoParts(entries: SessionEntry[]): Array<TextGroup | ActivityGroupData> {
  const flat: AssistantPart[] = [];
  for (const entry of entries) {
    for (const block of entry.content) {
      if (block.type === "thinking") {
        flat.push({ type: "thinking", text: block.text });
      } else if (block.type === "text" && block.text?.trim()) {
        flat.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        // `.at(-1)`: see the note in `groupMessages` above.
        const last = flat.at(-1);
        if (last && last.type === "tools") {
          last.tools.push(block);
        } else {
          flat.push({ type: "tools", tools: [block] });
        }
      }
    }
  }

  const grouped: Array<TextGroup | ActivityGroupData> = [];
  let activityBuf: ActivityPart[] = [];

  function flushActivity() {
    if (activityBuf.length > 0) {
      grouped.push({ kind: "activity", parts: activityBuf });
      activityBuf = [];
    }
  }

  for (const part of flat) {
    if (isActivityPart(part)) {
      activityBuf.push(part);
    } else {
      flushActivity();
      grouped.push({ kind: "text", text: part.text });
    }
  }
  flushActivity();

  return grouped;
}

/** Number of `<speech>` chunks in a text fragment (for absolute index offsets). */
export function countSpeech(text: string): number {
  const m = text.match(/<speech[\s>]/gi);
  return m ? m.length : 0;
}

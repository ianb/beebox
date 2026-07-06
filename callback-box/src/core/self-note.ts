/**
 * Self-note parsing — the single source of truth shared by the CLI/webapp
 * session scanners (`cli/lib/session`) and the frontend chat renderer
 * (`components/chat/message-parsing`).
 *
 * Self-notes are agent-authored, user-position messages wrapped in
 * `<self-note ref="..." commit="...">body</self-note>` (see `cb chat
 * self-note` and the webapp `POST /api/chat/self-note` endpoint). They are
 * not conversational input: the UI renders them as a distinct annotation and
 * the metadata scanners don't count them as user turns.
 */

import { stripChatAppTags } from "./chat/features.js";

/** Parsed self-note metadata. */
export interface SelfNoteInfo {
  ref: string | null;
  commit: string | null;
  body: string;
}

/** Decode the five predefined XML entities in an attribute value. */
export function decodeXmlAttr(v: string): string {
  return v
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * If `text` is composed entirely of one or more `<self-note>` blocks
 * (separated by whitespace, with no non-whitespace between them), return
 * the parsed notes. Otherwise null — a mixed message (self-notes plus
 * other text) falls through to normal user rendering so the other text
 * isn't silently hidden.
 *
 * Multiple notes per entry happen naturally: `ChatSession.drainQueue()`
 * concatenates queued messages with `\n\n`, so a burst of
 * `cb chat self-note` calls during one turn arrives as a single user
 * entry containing several `<self-note>` blocks back-to-back.
 */
export function parseSelfNotes(rawText: string): SelfNoteInfo[] | null {
  // The server prepends a `<chat-app .../>` snapshot to every turn, so a
  // self-note entry arrives as `<chat-app .../>\n<self-note ...>...`. Strip
  // the snapshot first, otherwise it counts as non-whitespace before the
  // first match and the whole entry falls through to normal user rendering.
  const text = stripChatAppTags(rawText);
  const re = /<self-note\b([^>]*)>([\S\s]*?)<\/self-note>/g;
  const notes: SelfNoteInfo[] = [];
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const between = text.slice(lastEnd, m.index);
    if (between.trim().length > 0) return null;
    const attrs = m[1] || "";
    const body = (m[2] || "").trim();
    const refMatch = attrs.match(/\bref="([^"]*)"/);
    const commitMatch = attrs.match(/\bcommit="([^"]*)"/);
    notes.push({
      ref: refMatch ? decodeXmlAttr(refMatch[1]!) : null,
      commit: commitMatch ? decodeXmlAttr(commitMatch[1]!) : null,
      body,
    });
    lastEnd = m.index + m[0].length;
  }
  if (notes.length === 0) return null;
  if (text.slice(lastEnd).trim().length > 0) return null;
  return notes;
}

/**
 * Legacy single-note accessor kept for call sites that expect one note.
 * Returns the first self-note in a pure-self-note text block, or null.
 * New code should prefer `parseSelfNotes`.
 */
export function parseSelfNote(text: string): SelfNoteInfo | null {
  const notes = parseSelfNotes(text);
  return notes && notes.length > 0 ? notes[0]! : null;
}

/**
 * Minimal shape of a session entry needed to extract self-notes. Both the CLI
 * (`cli/lib/session-entry.ts`) and frontend (`frontend/src/api-chat.ts`)
 * `SessionEntry` types structurally satisfy this, so the extractor is shared.
 */
export interface SelfNoteEntry {
  type: string;
  content: readonly { type: string; text?: string }[];
}

/**
 * Extract self-notes from a single session entry: notes only live in `user`
 * entries, in a `text` block whose content is entirely `<self-note>` blocks.
 * Returns null for any other entry (so it falls through to normal rendering).
 */
export function entrySelfNotes(entry: SelfNoteEntry): SelfNoteInfo[] | null {
  if (entry.type !== "user") return null;
  for (const block of entry.content) {
    if (block.type !== "text") continue;
    const notes = parseSelfNotes(block.text || "");
    if (notes) return notes;
  }
  return null;
}

/**
 * Session text helpers - classification of plumbing / compaction messages,
 * self-note parsing, speech-wrapper stripping, and snippet extraction. These
 * operate on the raw text of user-position messages and are shared by the
 * session scanners in `session.ts`. Split out to keep that file under the
 * line cap.
 */

import { stripChatAppTags } from "../../core/chat-features.js";

/** User messages that are internal Claude Code plumbing, not real user input */
const plumbingPatterns = [
  /^Tool loaded\.$/,
  /^Todos have been modified/,
];

export function isPlumbingMessage(text: string): boolean {
  const trimmed = text.trim();
  return plumbingPatterns.some((p) => p.test(trimmed));
}

/** Detect compaction summary messages injected by Claude Code after context compaction */
const COMPACTION_PREFIX = "This session is being continued from a previous conversation that ran out of context.";

export function isCompactionSummary(text: string): boolean {
  return text.trimStart().startsWith(COMPACTION_PREFIX);
}

/**
 * Parsed self-note metadata. Self-notes are agent-authored user-position
 * messages wrapped in `<self-note ref="..." commit="...">body</self-note>`.
 * See `cb chat self-note` and the webapp `/api/chat/self-note` endpoint.
 */
export interface SelfNoteInfo {
  ref: string | null;
  commit: string | null;
  body: string;
}

function decodeXmlAttr(v: string): string {
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
export function parseSelfNotes(text: string): SelfNoteInfo[] | null {
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
 * Strip voice-direction metadata and speech/typed tag shells from user text.
 * Used both for snippets in --list and for --dialogue-only rendering.
 */
export function stripSpeechWrappers(text: string): string {
  let out = text;
  // Drop <instructions>...</instructions> voice-direction blocks
  out = out.replace(/<instructions\b[^>]*>[\S\s]*?<\/instructions>/g, "");
  // Drop self-closing voice-keyword marker tags
  out = out.replace(/<(?:send-message|send-close-message|cancel-message|mic-off|erase-message)\b[^>]*\/>/g, "");
  // Drop the <chat-app …> snapshot tag prepended to every user message
  out = stripChatAppTags(out);
  // Unwrap outer <speech>/<typed> shells, keeping their text content
  out = out.replace(/<\/?(?:speech|typed)\b[^>]*>/g, "");
  return out;
}

export function extractSnippet(text: string, maxLen?: number): string | null {
  maxLen = maxLen ?? 60;
  const cleaned = stripSpeechWrappers(text).replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.substring(0, maxLen - 1).trimEnd() + "…";
}

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

// Self-note parsing lives in `core/self-note.ts` (shared with the frontend
// chat renderer). Re-exported here so callers of `cli/lib/session` — which
// itself re-exports from this module — keep their imports.
export { type SelfNoteInfo, parseSelfNote, parseSelfNotes } from "../../core/self-note.js";

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

/**
 * Third-person check on cards the person reads.
 *
 * The agent guide's SPEAKING section says to address the person as "you",
 * never "the user" or "the boxholder", and journey walks (2026-10-08) still
 * found "the user confirmed" on a card and "The boxholder is cataloguing" in a
 * briefing. More guide text did not help, so the card-write hook points at
 * the phrase the moment the agent writes it, while it can still fix it.
 *
 * It scans only the text the agent just wrote (a Write's content, an Edit's
 * new string), never the whole card: a clipped web page or an email on the
 * same card may say "the user" legitimately, and that is why this is not a
 * `bbx validate` rule. It covers cards under `_content/`, the person's own
 * area; `_bookkeeping/` and `_config/` hold agent-facing text where "the
 * user" is the right word. Advisory only: it adds context, never blocks.
 */

import { relative } from "node:path";
import { isRecord } from "../../shared/is-record.js";

const THIRD_PERSON = /\b(?:the\s+)?boxholder(?:'s|s)?\b|\bthe\s+user(?:'s)?\b/gi;

/** Whether a card at `boxRelativePath` is in the person's own area. */
function isPersonFacingCard(boxRelativePath: string): boolean {
  return boxRelativePath.startsWith("_content/") && boxRelativePath.endsWith(".card");
}

/** The text a Write, Edit, or MultiEdit call adds; empty for anything else. */
function writtenText(toolInput: unknown): string {
  if (!isRecord(toolInput)) return "";
  if (typeof toolInput.content === "string") return toolInput.content;
  if (typeof toolInput.new_string === "string") return toolInput.new_string;
  if (Array.isArray(toolInput.edits)) {
    return toolInput.edits
      .map((edit) => (isRecord(edit) && typeof edit.new_string === "string" ? edit.new_string : ""))
      .join("\n");
  }
  return "";
}

/** The distinct third-person phrases in `text`, lowercased, in first-seen order. */
export function thirdPersonPhrases(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(THIRD_PERSON)) found.add(match[0].toLowerCase().replace(/\s+/g, " "));
  return [...found];
}

/**
 * The advisory for a card write that calls the person "the user" or "the
 * boxholder", or null when there is nothing to say.
 */
export function thirdPersonWarning(input: { boxRoot: string; filePath: string; toolInput: unknown }): string | null {
  const boxRelativePath = relative(input.boxRoot, input.filePath);
  if (!isPersonFacingCard(boxRelativePath)) return null;
  const phrases = thirdPersonPhrases(writtenText(input.toolInput));
  if (phrases.length === 0) return null;
  const quoted = phrases.map((p) => `"${p}"`).join(", ");
  return (
    `${boxRelativePath} is shown to the person whose box this is, and the text you just wrote calls them ${quoted}. ` +
    "Write \"you\" (in a briefing, their own \"I\": \"I'm cataloguing my tools\"), unless the words quote someone else."
  );
}

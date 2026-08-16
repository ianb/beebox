/**
 * Compact transcript rendering, shared by the retrospective observer and the
 * nightly chat review (docs/implemented-plans/chat-review.md).
 *
 * Same register as `cb feedback`'s session-context block: user and agent text
 * plus one-line tool summaries, tool results skipped (noise without signal).
 * Voice-direction and `<typed>`/`<speech>` wrappers are stripped so a reader
 * quotes clean human text.
 *
 * Rendering and elision are deliberately separate. Retro wants the capped
 * one-shot form (`renderSessionCompact`); chat review gates on how much *new*
 * material a span holds, which the capped form cannot express — its output
 * stops growing at the cap, so a long session would look permanently
 * unchanged. Chat review therefore renders uncapped (`renderEntries`), measures,
 * and elides only what it hands to a model.
 *
 * (Moved from `core/retro/render.ts` when the second consumer arrived.)
 */

import { stripSpeechWrappers, type SessionEntry } from "../../cli/lib/session.js";
import { MAX_SESSION_ENTRIES, parseSessionLog } from "../../cli/lib/session.js";

/**
 * Hard cap on transcript text handed to a model, so one marathon session can't
 * blow a per-session budget. Over the cap, the middle is elided — corrections
 * and decisions show up at both ends of long conversations.
 */
export const MAX_RENDERED_CHARS = 40_000;

function renderEntry(entry: SessionEntry): string {
  const role = entry.type === "user" ? "User" : "Agent";
  const lines: string[] = [`**${role}** (${entry.timestamp})`];

  for (const block of entry.content) {
    if (block.type === "text" && block.text) {
      const text =
        entry.type === "user" ? stripSpeechWrappers(block.text).trim() : block.text.trim();
      if (text) lines.push(text);
    } else if (block.type === "tool_use") {
      const summary = block.inputSummary || "";
      lines.push(`→ ${block.toolName}${summary ? ": " + summary : ""}`);
    }
    // tool_result skipped — adds noise without value.
  }

  return lines.join("\n");
}

/** Elide the middle of `text` when it exceeds `maxChars`, keeping both ends. */
export function elideMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  const omitted = text.length - maxChars;
  return (
    text.substring(0, half) +
    `\n\n… (${omitted} chars of conversation elided) …\n\n` +
    text.substring(text.length - half)
  );
}

/**
 * Render already-parsed entries: dialogue plus tool one-liners, **uncapped**.
 * Compaction/interrupted markers are dropped, as are entries whose visible
 * content is only the role header.
 */
export function renderEntries(entries: SessionEntry[]): string {
  return entries
    .filter((entry) => entry.type === "user" || entry.type === "assistant")
    .map(renderEntry)
    .filter((text) => text.includes("\n")) // role header alone = nothing visible survived
    .join("\n\n---\n\n");
}

/**
 * Render a whole session transcript for a model, capped at
 * {@link MAX_RENDERED_CHARS}.
 *
 * Reads an explicit first page of at most {@link MAX_SESSION_ENTRIES} entries:
 * a transcript longer than that renders only its first page, as it did under
 * the old 10,000-entry default. See
 * issues/bugs/2026-07-28-parse-session-log-silent-page-truncation.md.
 */
export async function renderSessionCompact(logPath: string): Promise<string> {
  const { entries, total } = await parseSessionLog({
    logPath,
    slice: { mode: "page", offset: 0, limit: MAX_SESSION_ENTRIES },
  });
  if (entries.length < total) {
    console.warn(
      `renderSessionCompact: transcript ${logPath} has ${String(total)} entries; rendering the first ${String(entries.length)}.`,
    );
  }
  return elideMiddle(renderEntries(entries), MAX_RENDERED_CHARS);
}

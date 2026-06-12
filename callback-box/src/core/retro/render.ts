/**
 * Compact transcript rendering for the retrospective observer.
 *
 * Same register as `cb feedback`'s session-context block: user and agent
 * text plus one-line tool summaries, tool results skipped (noise without
 * signal for preference mining). Voice-direction and `<typed>`/`<speech>`
 * wrappers are stripped so the observer quotes clean human text.
 */

import {
  parseSessionLog,
  stripSpeechWrappers,
  type SessionEntry,
} from "../../cli/lib/session.js";

/**
 * Hard cap on rendered transcript size so one marathon session can't blow
 * the observer's budget. Over the cap, the middle is elided — corrections
 * and preferences show up at both ends of long conversations.
 */
const MAX_RENDERED_CHARS = 40_000;

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

function elideMiddle(text: string, maxChars: number): string {
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
 * Render a session transcript for the observer: dialogue plus tool
 * one-liners, capped in size. Compaction/interrupted markers are skipped.
 */
export async function renderSessionCompact(logPath: string): Promise<string> {
  const { entries } = await parseSessionLog({ logPath });
  const rendered = entries
    .filter((entry) => entry.type === "user" || entry.type === "assistant")
    .map(renderEntry)
    .filter((text) => text.includes("\n")) // role header alone = nothing visible survived
    .join("\n\n---\n\n");
  return elideMiddle(rendered, MAX_RENDERED_CHARS);
}

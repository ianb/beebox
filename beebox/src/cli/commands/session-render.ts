/**
 * Transcript rendering helpers for `bbx session`.
 *
 * Turns parsed session entries into the compact, human-readable lines the
 * command prints: tool-use one-liners, self-notes, and speaker-grouped text.
 */

import {
  entrySelfNotes,
  stripSpeechWrappers,
  type SelfNoteInfo,
  type SessionEntry,
  type SessionContentBlock,
} from "../lib/session.js";

export interface RenderOptions {
  full: boolean;
  dialogueOnly: boolean;
}

/**
 * Per-tool formatters for the common tools, keyed by tool name. Each returns a
 * compact one-liner, or null to skip the block. Tools not listed here fall back
 * to a generic rendering in `formatToolUse`.
 */
const toolFormatters: Record<
  string,
  (block: SessionContentBlock) => string | null
> = {
  Read: (block) => `  \u{1F4C2} Read ${block.input?.file_path || ""}`,
  Write: (block) => {
    const chars = String(block.input?.content || "").length;
    return `  \u{1F4DD} Write ${block.input?.file_path || ""} (${chars} chars)`;
  },
  Edit: (block) => `  \u{270F}\u{FE0F} Edit ${block.input?.file_path || ""}`,
  Bash: (block) =>
    `  \u{1F4BB} ${block.input?.description || block.inputSummary || ""}`,
  Glob: (block) => `  \u{1F4C2} Glob ${block.input?.pattern || ""}`,
  Grep: (block) =>
    `  \u{1F50D} Grep ${block.input?.pattern || ""} in ${block.input?.path || "."}`,
  Task: (block) => `  \u{1F500} Task: ${block.input?.description || ""}`,
  TodoWrite: () => null,
  WebFetch: (block) => `  \u{1F310} Fetch ${block.input?.url || ""}`,
  WebSearch: (block) => `  \u{1F50D} Search "${block.input?.query || ""}"`,
};

/**
 * Format a tool_use block as a compact one-liner.
 * Returns null to skip the block entirely.
 */
function formatToolUse(block: SessionContentBlock): string | null {
  const name = block.toolName || "";
  const formatter = toolFormatters[name];
  if (formatter) return formatter(block);
  return `  \u{1F527} ${name} ${block.inputSummary || ""}`;
}

function renderSelfNote(note: SelfNoteInfo, options: RenderOptions): void {
  const separator = "─".repeat(40);
  console.log(`── Self-note ${separator}`);
  if (!options.dialogueOnly) {
    if (note.ref) console.log(`  ref:    ${note.ref}`);
    if (note.commit) console.log(`  commit: ${note.commit}`);
    if (note.ref || note.commit) console.log();
  }
  for (const line of note.body.split("\n")) {
    console.log(`  ${line}`);
  }
  console.log();
}

/**
 * Compute the printable lines for one session entry. Returns empty array when
 * the entry would produce no output — caller suppresses the speaker header in
 * that case, which prevents empty `── Assistant ──` blocks.
 */
function computeEntryLines(entry: SessionEntry, options: RenderOptions): string[] {
  const lines: string[] = [];

  for (const block of entry.content) {
    if (block.type === "text") {
      let text = block.text?.trim() || "";
      if (!text) continue;
      if (options.dialogueOnly) {
        text = stripSpeechWrappers(text).replace(/\n{3,}/g, "\n\n").trim();
        if (!text) continue;
      }
      lines.push(text);
    } else if (block.type === "tool_use") {
      if (options.dialogueOnly) continue;
      const line = formatToolUse(block);
      if (line) lines.push(line);
    } else if (block.type === "tool_result") {
      if (options.dialogueOnly) continue;
      if (!options.full) continue;
      const summary = block.resultSummary?.trim();
      if (summary) lines.push(`  └─ ${summary.substring(0, 200)}`);
    }
    // thinking/image blocks: skip
  }

  return lines;
}

/**
 * Render entries with speaker headers emitted only when the entry has
 * content to print — this avoids the empty `── Assistant ──` blocks that
 * appear for thinking-only or TodoWrite-only entries in the JSONL log.
 */
export function renderEntries(entries: SessionEntry[], options: RenderOptions): void {
  const separator = "─".repeat(40);

  for (const entry of entries) {
    const notes = entrySelfNotes(entry);
    if (notes) {
      for (const note of notes) {
        renderSelfNote(note, options);
      }
      continue;
    }

    const lines = computeEntryLines(entry, options);
    if (lines.length === 0) continue;

    const speaker = entry.type === "user" ? "User" : "Assistant";
    console.log(`── ${speaker} ${separator}`);
    for (const line of lines) console.log(line);
    console.log();
  }
}

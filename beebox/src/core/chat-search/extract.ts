/**
 * Transcript entries → chat chunk documents. Pure: callers read transcripts
 * and pass parsed entries in.
 *
 * What gets indexed is the whole design decision (see
 * `docs/plans/chat-search.md` Track 2): user and assistant TEXT, in chunks
 * that point back at a position in the conversation. Tool calls and tool
 * results contribute nothing — noise for "which chat said X". User text is
 * wrapper-stripped so speech/typed envelopes don't pollute matches, the same
 * hygiene `transcript-render.ts` applies when quoting a human.
 *
 * Chunks accumulate WHOLE entries up to a character budget. A single entry
 * over the budget becomes one oversized chunk rather than being split —
 * there is no API length limit to satisfy (no embeddings), and keeping
 * entries whole keeps the anchor honest ("this entry starts this chunk").
 */

import {
  stripSpeechWrappers,
  type SessionEntry,
} from "../../cli/lib/session.js";
import { normalizeContent } from "../search/extract/core.js";
import type { ChatChunkDoc } from "./schema.js";

/** Soft target for chunk text; closing a chunk at or past this starts a new one. */
export const CHUNK_CHAR_BUDGET = 1600;

/**
 * The searchable text of one entry, or "" when the entry contributes none
 * (not dialogue, or nothing visible survived filtering).
 */
export function entrySearchText(entry: SessionEntry): string {
  if (entry.type !== "user" && entry.type !== "assistant") return "";
  const lines: string[] = [];
  for (const block of entry.content) {
    if (block.type !== "text") continue;
    const raw = block.text ?? "";
    const text = entry.type === "user" ? stripSpeechWrappers(raw).trim() : raw.trim();
    if (text !== "") lines.push(text);
  }
  return lines.join("\n");
}

export interface ChunkSessionInput {
  sessionId: string;
  /** Title as of indexing; rides every chunk this call produces. */
  title: string;
  /** Parsed entries of the WHOLE transcript (the cursor does the windowing). */
  entries: SessionEntry[];
  /**
   * Cursor: index of the first entry not yet chunked. Entries before it
   * were chunked by an earlier refresh; this call chunks from here so
   * incremental refreshes only insert new tail chunks.
   */
  fromIndex: number;
}

/** Build the chunk documents for `entries[fromIndex…]`. */
export function chunkSessionEntries(input: ChunkSessionInput): ChatChunkDoc[] {
  const docs: ChatChunkDoc[] = [];
  let current: { anchor: SessionEntry; parts: string[] } | null = null;

  const flush = (): void => {
    if (current === null) return;
    docs.push({
      id: `${input.sessionId}#${current.anchor.uuid}`,
      sessionId: input.sessionId,
      anchor: current.anchor.uuid,
      title: input.title,
      content: normalizeContent(current.parts.join("\n\n")),
      created: current.anchor.timestamp,
    });
    current = null;
  };

  for (let i = input.fromIndex; i < input.entries.length; i++) {
    const entry = input.entries[i];
    if (entry === undefined) continue;
    const text = entrySearchText(entry);
    if (text === "") continue;
    if (current === null) {
      current = { anchor: entry, parts: [text] };
      continue;
    }
    if (current.parts.join("\n\n").length >= CHUNK_CHAR_BUDGET) {
      flush();
      current = { anchor: entry, parts: [text] };
      continue;
    }
    current.parts.push(text);
  }
  flush();
  return docs;
}

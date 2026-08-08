/**
 * The first real user message of a transcript — what a chat is called in a
 * list when it has no editorial title.
 *
 * Read on its own, and read *lazily*: the scan stops at the first qualifying
 * user turn rather than folding the whole file, because that turn is a handful
 * of lines into a transcript that can be megabytes. `loadAllSessions` resolves
 * one label per chat in the box, so a full-file read per chat is the difference
 * between the landmark picker opening instantly and visibly hanging (measured
 * 2026-08-08 on a ~10k-file box: 65 chats, ~500ms of it this read).
 */

import * as fs from "node:fs";
import * as readline from "node:readline";
import { isRecord } from "../../lib/is-record.js";
import { contentBlocks, parseJsonlLine } from "./session-jsonl.js";
import {
  extractSnippet,
  isCompactionSummary,
  isPlumbingMessage,
  parseSelfNote,
} from "./session-text.js";

/**
 * The joined text of a user entry's blocks when the entry is a *real* user
 * turn, else null. Tool-result plumbing, compaction summaries, and self-notes
 * are the machine's own traffic in the user position, not something the person
 * said. The single definition of "a real user turn": turn tallies and list
 * labels both read it, so they can't disagree about what the first message was.
 */
export function userTurnText(blocks: Array<Record<string, unknown>>): string | null {
  const textBlocks = blocks.filter((b) => b.type === "text" && b.text && String(b.text).trim());
  if (textBlocks.length === 0) return null;
  const text = textBlocks.map((b) => String(b.text || "")).join("\n").trim();
  if (isPlumbingMessage(text) || isCompactionSummary(text)) return null;
  if (parseSelfNote(text)) return null;
  return text;
}

/**
 * First real user message of a transcript, trimmed to `snippetMaxLen`, or null
 * when the transcript holds none (a brand-new session, or one that is nothing
 * but plumbing). Throws the underlying fs error when the file can't be read —
 * callers decide whether an unreadable transcript is fatal or just unlabeled.
 */
export async function readFirstUserSnippet(args: {
  logPath: string;
  snippetMaxLen: number;
}): Promise<string | null> {
  const fileStream = fs.createReadStream(args.logPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const raw = parseJsonlLine(line, "readFirstUserSnippet");
      if (raw === null || raw.type !== "user") continue;
      // SDK meta prompts sit in the user position but were never typed.
      if (raw.isMeta === true) continue;
      const message = raw["message"];
      if (!isRecord(message)) continue;
      const text = userTurnText(contentBlocks(message["content"]));
      if (text === null) continue;
      const snippet = extractSnippet(text, args.snippetMaxLen);
      // A turn whose text is all speech-wrapper markup strips to nothing; keep
      // scanning rather than reporting the chat as unlabeled.
      if (snippet !== null) return snippet;
    }
    return null;
  } finally {
    // `break`/`return` out of the loop closes the interface but leaves the file
    // handle open until GC — the whole point here is not reading the rest.
    rl.close();
    fileStream.destroy();
  }
}

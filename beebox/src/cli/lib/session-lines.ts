/**
 * Read a session transcript line by line, with the oversize guard applied once.
 *
 * `session-oversize.ts` bounds what a scan parses, and `parseSessionLog` was the
 * only reader that used it. Three others walked the same transcripts and
 * `JSON.parse`d every line at whatever size it happened to be — a box with heavy
 * image use has lines of ~1.3 MB, and the parse builds an object graph several
 * times that. None was on the web hot path, so none of them caused the 2026-08
 * incident, but they were the same fuel behind slower readers
 * (`issues/code-quality/2026-08-25-transcript-readers-without-the-oversize-guard.md`).
 *
 * So the guard moved here, and every reader takes it by construction rather than
 * by remembering to. A caller sees one of two things per line:
 *
 * - `parseable` — the line, or the line with its media payloads removed. Safe to
 *   `JSON.parse`. `mediaStripped` says which, because a reader that renders
 *   images needs to know an empty payload was taken out rather than never sent.
 * - `oversize` — still past the bound with its images gone, so a genuinely
 *   enormous text turn. The raw line rides along for the one caller that makes
 *   a placeholder out of it; everything else skips it.
 *
 * **What this still does not bound:** the raw line itself. `readline` builds the
 * whole 1.3 MB string before anything can measure it. What the guard removes is
 * the object graph `JSON.parse` would build from it — the multiplier, not the
 * line. Removing the line too means reading the file in chunks and eliding
 * base64 runs while scanning, which `session-line-scan.ts` does for a single
 * addressed line and which this could grow into.
 */

import * as fs from "node:fs";
import * as readline from "node:readline";
import { isOversizeLine, stripInlineMedia } from "./session-oversize.js";

/** One line of a transcript, already measured against the byte bound. */
export type TranscriptLine =
  | { kind: "parseable"; lineNumber: number; text: string; mediaStripped: boolean }
  | { kind: "oversize"; lineNumber: number; raw: string };

/**
 * Stream a transcript's lines, guarded. `lineNumber` is 1-based and counts every
 * line including the skipped ones, so it stays a stable identity across re-scans
 * of the same file.
 *
 * Breaking out of the loop early is expected — `readFirstUserSnippet` stops at
 * the first real user message, and the whole point there is not reading the
 * rest. The generator's `finally` closes the interface and destroys the handle,
 * so an early exit cannot leave the file open until GC.
 */
export async function* readTranscriptLines(logPath: string): AsyncGenerator<TranscriptLine> {
  const fileStream = fs.createReadStream(logPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of rl) {
      lineNumber += 1;
      if (!isOversizeLine(line)) {
        yield { kind: "parseable", lineNumber, text: line, mediaStripped: false };
        continue;
      }
      // Almost every oversize line is oversize because it carries an image.
      // Drop the payload and the rest of the turn parses normally and cheaply.
      const stripped = stripInlineMedia(line);
      if (stripped === null || isOversizeLine(stripped)) {
        yield { kind: "oversize", lineNumber, raw: line };
        continue;
      }
      yield { kind: "parseable", lineNumber, text: stripped, mediaStripped: true };
    }
  } finally {
    rl.close();
    fileStream.destroy();
  }
}

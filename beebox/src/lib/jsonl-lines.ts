/**
 * Split a JSONL stream into lines on `\n` only.
 *
 * `node:readline` is the obvious tool and the wrong one: it also ends a line at
 * U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR). JSON allows both raw
 * inside a string, and `JSON.stringify` leaves them raw, so a transcript entry
 * holding pasted text with one of them came back from readline as two or three
 * fragments that each failed `JSON.parse` — the entry vanished from chat history.
 *
 * Semantics otherwise match `readline` with `crlfDelay: Infinity`: one trailing
 * `\r` is removed (a CRLF file reads the same as an LF one), empty lines between
 * newlines are yielded, and a final line without a trailing newline is yielded
 * when it is non-empty.
 *
 * The caller owns the stream. Leaving the loop early ends the stream's async
 * iterator, which destroys the stream.
 */

import { StringDecoder } from "node:string_decoder";

export async function* jsonlLines(input: AsyncIterable<Buffer | string>): AsyncGenerator<string> {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  for await (const chunk of input) {
    // Only the new text can hold a newline: `pending` is a partial line. Starting
    // the search there keeps a multi-megabyte line from being rescanned per chunk.
    let scanFrom = pending.length;
    pending += typeof chunk === "string" ? chunk : decoder.write(chunk);
    let lineStart = 0;
    let newline = pending.indexOf("\n", scanFrom);
    while (newline !== -1) {
      yield stripCarriageReturn(pending.slice(lineStart, newline));
      lineStart = newline + 1;
      scanFrom = lineStart;
      newline = pending.indexOf("\n", scanFrom);
    }
    pending = pending.slice(lineStart);
  }
  pending += decoder.end();
  if (pending !== "") yield stripCarriageReturn(pending);
}

function stripCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

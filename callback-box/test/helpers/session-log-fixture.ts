/**
 * Synthesize a large Claude Code session transcript (JSONL) for the bounded-
 * parse regression test.
 *
 * The lines mirror the real transcript shapes `parseSessionLog` retains in
 * full: a `Write` tool_use whose `input.content` is the entire file body
 * (`session-content.ts` keeps `input` verbatim), a base64 image block
 * (`dataBase64` kept verbatim), and plain text blocks. That is what makes an
 * unbounded parse allocate roughly the whole file.
 */

import * as fs from "node:fs";
import { once } from "node:events";

/** Roughly how many bytes of payload each generated entry carries. */
export interface SessionLogFixtureOptions {
  /** Where to write the JSONL. */
  logPath: string;
  /** How many transcript lines to write (real + plumbing). */
  lines: number;
  /** Payload bytes per fat line (tool_use content / image data). */
  payloadBytes: number;
}

function stamp(i: number): string {
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);
  return new Date(base + i * 1000).toISOString();
}

function assistantLine(i: number, payload: string): string {
  return JSON.stringify({
    parentUuid: i === 0 ? null : `uuid-${String(i - 1)}`,
    isSidechain: false,
    userType: "external",
    cwd: "/box",
    sessionId: "11111111-2222-3333-4444-555555555555",
    version: "2.0.0",
    gitBranch: "main",
    type: "assistant",
    uuid: `uuid-${String(i)}`,
    timestamp: stamp(i),
    message: {
      id: `msg_${String(i)}`,
      type: "message",
      role: "assistant",
      model: "claude-opus-4-5",
      content: [
        { type: "text", text: `Writing notes file ${String(i)}.` },
        {
          type: "tool_use",
          id: `toolu_${String(i)}`,
          name: "Write",
          input: { file_path: `/box/notes/note-${String(i)}.md`, content: payload },
        },
      ],
      stop_reason: "tool_use",
    },
  });
}

function toolResultLine(i: number): string {
  return JSON.stringify({
    parentUuid: `uuid-${String(i - 1)}`,
    type: "user",
    uuid: `uuid-${String(i)}`,
    timestamp: stamp(i),
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: `toolu_${String(i - 1)}`, content: "File created successfully." },
      ],
    },
  });
}

function userLine(i: number, payload: string): string {
  return JSON.stringify({
    parentUuid: `uuid-${String(i - 1)}`,
    type: "user",
    uuid: `uuid-${String(i)}`,
    timestamp: stamp(i),
    message: {
      role: "user",
      content: [
        { type: "text", text: `<typed user="Ada Lovelace" user-email="ada@example.com">Message ${String(i)}</typed>` },
        { type: "image", source: { type: "base64", media_type: "image/png", data: payload } },
      ],
    },
  });
}

/**
 * Write the fixture. Every 4th line is a real (`<typed>`) user message with a
 * base64 image; the rest alternate assistant tool calls and their tool_result
 * plumbing turns (which `parseSessionLog` drops, exactly as in real logs).
 */
export async function writeBigSessionLog(options: SessionLogFixtureOptions): Promise<void> {
  const { logPath, lines, payloadBytes } = options;
  const payload = "x".repeat(payloadBytes);
  const base64Payload = Buffer.from(payload).toString("base64");
  const out = fs.createWriteStream(logPath, { encoding: "utf-8" });
  for (let i = 0; i < lines; i++) {
    const line =
      i % 4 === 0
        ? userLine(i, base64Payload)
        : i % 4 === 2
          ? toolResultLine(i)
          : assistantLine(i, payload);
    if (!out.write(`${line}\n`)) await once(out, "drain");
  }
  out.end();
  await once(out, "finish");
}

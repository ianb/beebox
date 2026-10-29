/**
 * pi's session files read as chat history (`docs/plans/pi-box-engine.md`,
 * Track 5), without loading pi: `SessionManager.open` parses the whole file,
 * and this reads it with the same bounded scan as Claude's JSONL.
 *
 * The format is pi's documented JSONL, version 3 (`docs/session-format.md` in
 * the pi package): a `session` header, then entries. Each pi message is
 * restated as the Claude record it corresponds to and built by `buildEntry`,
 * so identity tags, plumbing filters and tool-result grafting are Claude's:
 * user text becomes a user entry, assistant text and tool calls an assistant
 * entry, and a tool result rides on its call. Thinking is dropped, as the
 * Codex adapter drops it; a `compaction` entry shows its summary. System
 * prompts, model changes, usage and extension entries are not dialogue.
 *
 * beebox never branches a pi session, so file order is the conversation; the
 * `parentId` tree is not walked.
 */

import { rm } from "node:fs/promises";
import { listPiSessionFiles } from "../../pi-sessions.js";
import { readTranscriptLines } from "../../../cli/lib/session-lines.js";
import { contentBlocks, parseJsonlLine } from "../../../cli/lib/session-jsonl.js";
import { buildEntry, type SessionEntry } from "../../../cli/lib/session-entry.js";
import { SessionScan, type SessionLogResult, type SessionLogSlice } from "../../../cli/lib/session-retention.js";
import { snippetFromUserText } from "../../../cli/lib/session-snippet.js";
import { isRecord } from "../../../shared/is-record.js";

const PI_SESSION_VERSION = 3;

class PiSessionVersionError extends Error {
  constructor(path: string, version: unknown) {
    super(`pi session ${path} has format version ${String(version)}; beebox reads version ${String(PI_SESSION_VERSION)}`);
    this.name = "PiSessionVersionError";
  }
}

/** The session's files, oldest first. pi writes one; a delete removes any. */
export async function piSessionFiles(boxRoot: string, sessionId: string): Promise<string[]> {
  return (await listPiSessionFiles(boxRoot)).filter((file) => file.sessionId === sessionId).map((file) => file.path).toSorted();
}

/** The session's file, or `null` when pi has none. */
export async function findPiSessionFile(boxRoot: string, sessionId: string): Promise<string | null> {
  return (await piSessionFiles(boxRoot, sessionId)).at(-1) ?? null;
}

/** Remove the session's files; `"absent"` once none remain. */
export async function deletePiSession(boxRoot: string, sessionId: string): Promise<"absent" | "present"> {
  for (const path of await piSessionFiles(boxRoot, sessionId)) await rm(path, { force: true });
  return (await piSessionFiles(boxRoot, sessionId)).length === 0 ? "absent" : "present";
}

function claudeBlock(block: Record<string, unknown>): Record<string, unknown> {
  if (block.type === "toolCall") return { type: "tool_use", id: block.id, name: block.name, input: block.arguments };
  if (block.type === "image") return { type: "image", source: { type: "base64", media_type: block.mimeType, data: block.data } };
  return block;
}

/** A pi message as the Claude record `buildEntry` reads, or `null` when it is not dialogue. */
function claudeMessage(message: Record<string, unknown>): { type: "user" | "assistant"; message: Record<string, unknown> } | null {
  const content = contentBlocks(message["content"]).filter((block) => block.type !== "thinking").map(claudeBlock);
  switch (message["role"]) {
    case "user":
      return { type: "user", message: { content } };
    case "assistant":
      return { type: "assistant", message: { content, model: message["model"] } };
    case "toolResult":
      return { type: "user", message: { content: [{ type: "tool_result", tool_use_id: message["toolCallId"], content }] } };
    default:
      return null;
  }
}

/**
 * Each parsed line of a pi session file, after the header's version is
 * checked. `mediaSessionId` is the header's session id on a line whose image
 * payloads were stripped: its images are then served by the session-media
 * route, which finds the line by its entry `id`.
 */
async function* piLines(path: string): AsyncGenerator<{ raw: Record<string, unknown>; mediaSessionId: string | null }> {
  let sessionId: string | null = null;
  for await (const line of readTranscriptLines(path)) {
    // A line past the byte bound even without its images: not shown, as Claude's is not parsed.
    if (line.kind === "oversize") continue;
    const raw = parseJsonlLine(line.text, "pi-transcript");
    if (raw === null) continue;
    if (raw.type === "session") {
      if (raw["version"] !== PI_SESSION_VERSION) throw new PiSessionVersionError(path, raw["version"]);
      sessionId = typeof raw["id"] === "string" ? raw["id"] : null;
    }
    yield { raw, mediaSessionId: line.mediaStripped ? sessionId : null };
  }
}

function piEntry(
  { raw, mediaSessionId }: { raw: Record<string, unknown>; mediaSessionId: string | null },
  recent: SessionEntry[],
): SessionEntry | null {
  const meta = { uuid: String(raw["id"] ?? ""), timestamp: String(raw["timestamp"] ?? "") };
  if (raw.type === "compaction") {
    const summary = typeof raw["summary"] === "string" ? [{ type: "text" as const, text: raw["summary"] }] : [];
    return { ...meta, type: "compaction", content: summary };
  }
  if (raw.type !== "message" || !isRecord(raw["message"])) return null;
  const record = claudeMessage(raw["message"]);
  return record === null ? null : buildEntry({ ...meta, ...record }, { recent, mediaSessionId });
}

/** A slice of one pi session file. Throws ENOENT when the file is gone, as `parseSessionLog` does. */
export async function parsePiSessionLog(params: { path: string; slice: SessionLogSlice }): Promise<SessionLogResult> {
  const scan = new SessionScan(params.slice);
  for await (const line of piLines(params.path)) {
    const entry = piEntry(line, scan.recent());
    if (entry !== null) scan.record(entry);
  }
  return scan.result();
}

/** The session's first real user message as a list label snippet, or `null`. */
export async function readPiFirstUserSnippet(args: { path: string; snippetMaxLen: number }): Promise<string | null> {
  for await (const { raw } of piLines(args.path)) {
    const message = isRecord(raw["message"]) ? raw["message"] : null;
    if (raw.type !== "message" || message?.["role"] !== "user") continue;
    const text = contentBlocks(message["content"]).filter((block) => block.type === "text").map((block) => String(block["text"] ?? "")).join("\n");
    const snippet = snippetFromUserText(text, args.snippetMaxLen);
    if (snippet !== null) return snippet;
  }
  return null;
}


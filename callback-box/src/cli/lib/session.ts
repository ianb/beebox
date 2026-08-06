/**
 * Session log parsing - shared between CLI and web routes.
 *
 * Claude Code stores session transcripts as JSONL files at:
 *   ~/.claude/projects/<encoded-box-path>/<session-id>.jsonl
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { isRecord } from "../../lib/is-record.js";

import { buildEntry } from "./session-entry.js";
import { isOversizeLine, oversizeEntry } from "./session-oversize.js";
import {
  SessionScan,
  type SessionLogResult,
  type SessionLogSlice,
} from "./session-retention.js";
import {
  listSessionRoots,
  loadHistoryEntries,
  resolveSessionLogPath,
} from "../../core/chat/session/history.js";
import { listSessionFilesInDir } from "../../core/chat/session/transcript-paths.js";
import { ok, err, type Result } from "../../lib/result.js";
import {
  extractSnippet,
  isCompactionSummary,
  isPlumbingMessage,
  parseSelfNote,
} from "./session-text.js";

// Re-exported so existing callers of `cli/lib/session` keep their imports.
export {
  MAX_RETAINED_BYTES,
  MAX_SESSION_ENTRIES,
  type SessionLogResult,
  type SessionLogSlice,
} from "./session-retention.js";
export { isRealUserMessage } from "./session-real-user.js";
export {
  type SessionContentBlock,
  summarizeToolInput,
  summarizeToolResult,
  transformContent,
} from "./session-content.js";
export {
  type SelfNoteInfo,
  parseSelfNote,
  parseSelfNotes,
  entrySelfNotes,
  stripSpeechWrappers,
} from "./session-text.js";
export { type SessionEntry } from "./session-entry.js";
export { MAX_SESSION_LINE_BYTES } from "./session-oversize.js";

/** One session transcript discovered on disk, tagged with its context root. */
export interface SessionInfo {
  sessionId: string;
  mtime: Date;
  path: string;
  /** Box-relative context dir the session's cwd encoded to ("" = box root). */
  contextDir: string;
}

/**
 * List session files for a box across every context root — the box root
 * plus each landmark subdirectory recorded in the session history (a
 * landmark-bound chat's transcript lives under its own encoded dir in
 * `~/.claude/projects/`). Sorted by modification time, newest first.
 * Roots are deduped by encoded dir name, so a file is never listed twice.
 *
 * Labels come from the session's own history binding when it has one:
 * the projects-dir encoding is lossy (`store/a-b` and `store/a_b` share
 * an encoded dir), so the root a file was found under can't be trusted
 * to name its contextDir. The root's contextDir is only the fallback
 * for ids history doesn't know.
 */
export async function listSessions(boxRoot: string): Promise<SessionInfo[]> {
  const roots = await listSessionRoots(boxRoot);
  const entries = await loadHistoryEntries(boxRoot);
  const boundContextDirs = new Map<string, string>();
  for (const entry of entries) {
    if (entry.contextDir !== undefined) boundContextDirs.set(entry.id, entry.contextDir);
  }
  const perRoot = await Promise.all(
    roots.map(async (root) => {
      const files = await listSessionFilesInDir(root.dir);
      return files.map((f) => ({
        ...f,
        contextDir: boundContextDirs.get(f.sessionId) ?? root.contextDir,
      }));
    })
  );
  const sessions = perRoot.flat();
  sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return sessions;
}

/**
 * Find an explicit session id's transcript: the history file's
 * contextDir-aware answer first, then a probe of every context root.
 * The error arm carries every directory searched, so callers can report
 * the full sweep on a miss rather than a single misleading path.
 */
export async function findSessionLog(
  boxRoot: string,
  sessionId: string
): Promise<Result<string, string[]>> {
  const historyPath = await resolveSessionLogPath(boxRoot, sessionId);
  if (fs.existsSync(historyPath)) return ok(historyPath);

  const searched: string[] = [path.dirname(historyPath)];
  const roots = await listSessionRoots(boxRoot);
  for (const root of roots) {
    const candidate = path.join(root.dir, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) return ok(candidate);
    if (!searched.includes(root.dir)) searched.push(root.dir);
  }
  return err(searched);
}

/**
 * Parse one JSONL line, returning null for blank lines and unparseable lines
 * (a partial/concurrent write shouldn't abort the whole scan). `where`
 * identifies the caller in the debug log when a line is dropped.
 */
function parseJsonlLine(line: string, where: string): Record<string, unknown> | null {
  if (!line.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch (e) {
    console.debug(`${where}: skipping unparseable JSONL line:`, e);
    return null;
  }
}

/** Normalize a raw `message.content` field into an array of block records. */
function contentBlocks(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content.filter(isRecord);
  return [];
}

/**
 * Summary info for a session — used by --list enrichment and --since filtering.
 */
export interface SessionMetadata {
  sessionId: string;
  path: string;
  startTime: Date | null;
  endTime: Date | null;
  userTurns: number;
  assistantTurns: number;
  toolCount: number;
  firstUserSnippet: string | null;
}

/** Accumulator threaded through the per-line scan in getSessionMetadata. */
interface MetadataAccumulator {
  userTurns: number;
  assistantTurns: number;
  toolCount: number;
  firstUserSnippet: string | null;
}

/**
 * Fold a user entry's blocks into the metadata accumulator. Returns true when
 * the entry counted as a real user turn (so the caller advances timestamps).
 */
function foldUserMetadata(
  blocks: Array<Record<string, unknown>>,
  args: { acc: MetadataAccumulator; snippetMaxLen: number | undefined }
): boolean {
  const { acc, snippetMaxLen } = args;
  const textBlocks = blocks.filter(
    (b) => b.type === "text" && b.text && String(b.text).trim()
  );
  if (textBlocks.length === 0) return false;
  const text = textBlocks.map((b) => String(b.text || "")).join("\n").trim();
  if (isPlumbingMessage(text) || isCompactionSummary(text)) return false;
  if (parseSelfNote(text)) return false;
  acc.userTurns += 1;
  if (acc.firstUserSnippet === null) {
    acc.firstUserSnippet = extractSnippet(text, snippetMaxLen);
  }
  return true;
}

/**
 * Fold an assistant entry's blocks into the metadata accumulator. Returns true
 * when the entry had visible content (so the caller advances timestamps).
 */
function foldAssistantMetadata(
  blocks: Array<Record<string, unknown>>,
  acc: MetadataAccumulator
): boolean {
  let hasVisible = false;
  for (const block of blocks) {
    if (block.type === "text" && block.text && String(block.text).trim()) {
      hasVisible = true;
    }
    if (block.type === "tool_use") {
      acc.toolCount += 1;
      hasVisible = true;
    }
  }
  if (!hasVisible) return false;
  acc.assistantTurns += 1;
  return true;
}

/**
 * Scan a session log once and compute summary metadata. Turn counts match the
 * semantics used by --tool-report (`writeSessionReport`): user turns count
 * entries with real text (not tool_result plumbing); assistant turns count
 * entries with text or tool_use.
 */
export async function getSessionMetadata(args: {
  sessionId: string;
  logPath: string;
  /** Max chars of the first user message captured in `firstUserSnippet`. Default 60. */
  snippetMaxLen?: number;
}): Promise<SessionMetadata> {
  const fileStream = fs.createReadStream(args.logPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let startTime: Date | null = null;
  let endTime: Date | null = null;
  const acc: MetadataAccumulator = {
    userTurns: 0,
    assistantTurns: 0,
    toolCount: 0,
    firstUserSnippet: null,
  };

  for await (const line of rl) {
    const raw = parseJsonlLine(line, "getSessionMetadata");
    if (!raw) continue;
    if (raw.type !== "user" && raw.type !== "assistant") continue;

    const message = isRecord(raw["message"]) ? raw["message"] : undefined;
    if (!message) continue;

    // Skip SDK meta prompts and synthetic assistant responses
    if (raw.isMeta === true) continue;
    if (raw.type === "assistant" && message.model === "<synthetic>") continue;

    const blocks = contentBlocks(message.content);
    const counted =
      raw.type === "user"
        ? foldUserMetadata(blocks, { acc, snippetMaxLen: args.snippetMaxLen })
        : foldAssistantMetadata(blocks, acc);
    if (!counted) continue;

    const ts = raw.timestamp ? new Date(String(raw.timestamp)) : null;
    if (ts && !isNaN(ts.getTime())) {
      if (!startTime) startTime = ts;
      endTime = ts;
    }
  }

  return {
    sessionId: args.sessionId,
    path: args.logPath,
    startTime,
    endTime,
    userTurns: acc.userTurns,
    assistantTurns: acc.assistantTurns,
    toolCount: acc.toolCount,
    firstUserSnippet: acc.firstUserSnippet,
  };
}

/**
 * Parameters for parseSessionLog. The `slice` is mandatory: a caller must say
 * how much of the transcript it wants retained, because there is no unbounded
 * shape to fall back to (see `session-retention.ts`).
 */
export interface ParseSessionLogParams {
  logPath: string;
  slice: SessionLogSlice;
}

/**
 * Parse a session log JSONL file, retaining only what `slice` asks for.
 *
 * The scan is forward and single-pass: every displayable entry is counted
 * (`total` is exact, so paging affordances stay correct) but only the
 * requested window is kept alive.
 */
export async function parseSessionLog(
  params: ParseSessionLogParams
): Promise<SessionLogResult> {
  const { logPath, slice } = params;
  const fileStream = fs.createReadStream(logPath, { encoding: "utf-8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const scan = new SessionScan(slice);

  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber += 1;
    // A pathologically long line is never parsed — see `session-oversize.ts`.
    // It is dropped if its head shows plumbing the scan would drop anyway;
    // otherwise the stub it becomes counts as one displayable entry (so `total`
    // and `hasMore` stay honest), is never a real user message, and carries no
    // `tool_use` block for a later `tool_result` to graft onto.
    if (isOversizeLine(line)) {
      const stub = oversizeEntry(line, lineNumber);
      if (stub) scan.record(stub);
      continue;
    }
    const raw = parseJsonlLine(line, "parseSessionLog");
    if (!raw) continue;
    const entry = buildEntry(raw, scan.recent());
    if (entry) scan.record(entry);
  }

  return scan.result();
}

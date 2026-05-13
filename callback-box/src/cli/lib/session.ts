/**
 * Session log parsing - shared between CLI and web routes.
 *
 * Claude Code stores session transcripts as JSONL files at:
 *   ~/.claude/projects/<encoded-box-path>/<session-id>.jsonl
 */

import * as fs from "node:fs";
import * as readline from "node:readline";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Content block from a session log entry.
 */
export interface SessionContentBlock {
  type: "text" | "tool_use" | "tool_result" | "thinking" | "image";
  text?: string;
  toolName?: string;
  toolId?: string;
  inputSummary?: string;
  /** Raw input from the tool_use block, for richer formatting in CLI */
  input?: Record<string, unknown>;
  toolUseId?: string;
  resultSummary?: string;
  /** For image blocks: MIME type like "image/png" */
  mediaType?: string;
  /** For image blocks with base64 source: raw base64 (no data: prefix) */
  dataBase64?: string;
  /** For image blocks with URL source */
  imageUrl?: string;
}

/**
 * Parsed session log entry.
 */
export interface SessionEntry {
  uuid: string;
  type: "user" | "assistant" | "compaction" | "interrupted";
  timestamp: string;
  content: SessionContentBlock[];
  /** Display name of the sender (for user messages in multi-user chat) */
  user?: string;
  /** Email of the sender (for identity matching across devices) */
  userEmail?: string;
}

/**
 * Encode a cwd into Claude Code's `~/.claude/projects/<dir>` key. The
 * SDK replaces every non-alphanumeric character with `-`, not just `/`
 * — so paths with `_`, `.`, spaces, etc. all collapse to the same shape.
 * Match that here, otherwise `getSessionLogPath` mis-resolves for any
 * cwd containing non-`/` separators (e.g. landmark-session audits).
 */
function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^\dA-Za-z]/g, "-");
}

/**
 * Get the path to a Claude Code session log file. `cwd` is whatever
 * was passed as the SDK's `cwd` for the run — usually the box root,
 * but a landmark-bound chat or audit uses a subdirectory.
 */
export function getSessionLogPath(cwd: string, sessionId: string): string {
  const claudeDir = path.join(os.homedir(), ".claude", "projects", encodeProjectDir(cwd));
  return path.join(claudeDir, `${sessionId}.jsonl`);
}

/**
 * Get the Claude Code projects directory for a given SDK cwd.
 */
export function getSessionDir(cwd: string): string {
  return path.join(os.homedir(), ".claude", "projects", encodeProjectDir(cwd));
}

/**
 * List session files for a box, sorted by modification time (newest first).
 */
export async function listSessions(
  boxRoot: string
): Promise<Array<{ sessionId: string; mtime: Date; path: string }>> {
  const dir = getSessionDir(boxRoot);

  let files: string[];
  try {
    files = await fs.promises.readdir(dir);
  } catch {
    return [];
  }

  const sessions: Array<{ sessionId: string; mtime: Date; path: string }> = [];

  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const sessionId = file.replace(/\.jsonl$/, "");
    const filePath = path.join(dir, file);
    try {
      const stat = await fs.promises.stat(filePath);
      sessions.push({ sessionId, mtime: stat.mtime, path: filePath });
    } catch {
      continue;
    }
  }

  sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return sessions;
}

/** User messages that are internal Claude Code plumbing, not real user input */
const plumbingPatterns = [
  /^Tool loaded\.$/,
  /^Todos have been modified/,
];

function isPlumbingMessage(text: string): boolean {
  const trimmed = text.trim();
  return plumbingPatterns.some((p) => p.test(trimmed));
}

/** Detect compaction summary messages injected by Claude Code after context compaction */
const COMPACTION_PREFIX = "This session is being continued from a previous conversation that ran out of context.";

function isCompactionSummary(text: string): boolean {
  return text.trimStart().startsWith(COMPACTION_PREFIX);
}

/**
 * Summarize tool input for compact display.
 */
export function summarizeToolInput(
  toolName: string,
  input: Record<string, unknown>
): string {
  if (!input) return "";

  switch (toolName) {
    case "Read":
      return String(input.file_path || "");
    case "Edit":
      return String(input.file_path || "");
    case "Write":
      return `${input.file_path} (${String(input.content || "").length} chars)`;
    case "Bash":
      return String(input.description || input.command || "").substring(0, 120);
    case "Glob":
      return String(input.pattern || "");
    case "Grep":
      return `${input.pattern} in ${input.path || "."}`;
    case "TodoWrite":
      return "update todos";
    case "Task":
      return String(input.description || input.prompt || "").substring(0, 120);
    default:
      return JSON.stringify(input).substring(0, 150);
  }
}

/**
 * Summarize tool result content for compact display.
 */
export function summarizeToolResult(content: unknown): string {
  if (typeof content === "string") {
    return content.substring(0, 500);
  }
  if (Array.isArray(content)) {
    return content
      .map((c: unknown) =>
        typeof c === "string" ? c : (c as { text?: string })?.text || ""
      )
      .join("\n")
      .substring(0, 500);
  }
  return "";
}

/**
 * Transform raw message content into SessionContentBlocks.
 */
export function transformContent(content: unknown): SessionContentBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  if (!Array.isArray(content)) return [];

  const blocks: SessionContentBlock[] = [];
  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type === "text") {
      blocks.push({ type: "text", text: String(block.text || "") });
      continue;
    }

    if (block.type === "tool_use") {
      const input = (block.input || {}) as Record<string, unknown>;
      blocks.push({
        type: "tool_use",
        toolName: String(block.name || ""),
        toolId: String(block.id || ""),
        input,
        inputSummary: summarizeToolInput(String(block.name || ""), input),
      });
      continue;
    }

    if (block.type === "tool_result") {
      blocks.push({
        type: "tool_result",
        toolUseId: String(block.tool_use_id || ""),
        resultSummary: summarizeToolResult(block.content),
      });
      continue;
    }

    if (block.type === "thinking") {
      blocks.push({ type: "thinking", text: String(block.thinking || "") });
      continue;
    }
    if (block.type === "redacted_thinking") {
      blocks.push({ type: "thinking", text: "[redacted]" });
      continue;
    }

    if (block.type === "image") {
      // Preserve image blocks so user-pasted images render in history.
      // PDF-reading plumbing (user-role turns containing only images) is
      // filtered at the message level below — turns with no text content
      // get dropped entirely, so synthetic image-only plumbing stays hidden.
      const source = block.source as
        | { type?: string; media_type?: string; data?: string; url?: string }
        | undefined;
      const imgBlock: SessionContentBlock = { type: "image" };
      if (source?.media_type) imgBlock.mediaType = String(source.media_type);
      if (source?.type === "base64" && source.data) {
        imgBlock.dataBase64 = String(source.data);
      }
      if (source?.type === "url" && source.url) {
        imgBlock.imageUrl = String(source.url);
      }
      blocks.push(imgBlock);
      continue;
    }

    // Unknown block types: fall through with a placeholder so we don't
    // silently swallow something new. This is visible in the UI, which is
    // the point — we want to notice new block types.
    blocks.push({ type: "text", text: `[${String(block.type)}]` });
  }
  return blocks;
}

/**
 * Parsed self-note metadata. Self-notes are agent-authored user-position
 * messages wrapped in `<self-note ref="..." commit="...">body</self-note>`.
 * See `cb chat self-note` and the webapp `/api/chat/self-note` endpoint.
 */
export interface SelfNoteInfo {
  ref: string | null;
  commit: string | null;
  body: string;
}

function decodeXmlAttr(v: string): string {
  return v
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * If `text` is composed entirely of one or more `<self-note>` blocks
 * (separated by whitespace, with no non-whitespace between them), return
 * the parsed notes. Otherwise null — a mixed message (self-notes plus
 * other text) falls through to normal user rendering so the other text
 * isn't silently hidden.
 *
 * Multiple notes per entry happen naturally: `ChatSession.drainQueue()`
 * concatenates queued messages with `\n\n`, so a burst of
 * `cb chat self-note` calls during one turn arrives as a single user
 * entry containing several `<self-note>` blocks back-to-back.
 */
export function parseSelfNotes(text: string): SelfNoteInfo[] | null {
  const re = /<self-note\b([^>]*)>([\S\s]*?)<\/self-note>/g;
  const notes: SelfNoteInfo[] = [];
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const between = text.slice(lastEnd, m.index);
    if (between.trim().length > 0) return null;
    const attrs = m[1] || "";
    const body = (m[2] || "").trim();
    const refMatch = attrs.match(/\bref="([^"]*)"/);
    const commitMatch = attrs.match(/\bcommit="([^"]*)"/);
    notes.push({
      ref: refMatch ? decodeXmlAttr(refMatch[1]!) : null,
      commit: commitMatch ? decodeXmlAttr(commitMatch[1]!) : null,
      body,
    });
    lastEnd = m.index + m[0].length;
  }
  if (notes.length === 0) return null;
  if (text.slice(lastEnd).trim().length > 0) return null;
  return notes;
}

/**
 * Legacy single-note accessor kept for call sites that expect one note.
 * Returns the first self-note in a pure-self-note text block, or null.
 * New code should prefer `parseSelfNotes`.
 */
export function parseSelfNote(text: string): SelfNoteInfo | null {
  const notes = parseSelfNotes(text);
  return notes && notes.length > 0 ? notes[0]! : null;
}

/**
 * Strip voice-direction metadata and speech/typed tag shells from user text.
 * Used both for snippets in --list and for --dialogue-only rendering.
 */
export function stripSpeechWrappers(text: string): string {
  let out = text;
  // Drop <instructions>...</instructions> voice-direction blocks
  out = out.replace(/<instructions\b[^>]*>[\S\s]*?<\/instructions>/g, "");
  // Drop self-closing voice-keyword marker tags
  out = out.replace(/<(?:send-message|cancel-message|mic-off|erase-message)\b[^>]*\/>/g, "");
  // Unwrap outer <speech>/<typed> shells, keeping their text content
  out = out.replace(/<\/?(?:speech|typed)\b[^>]*>/g, "");
  return out;
}

function extractSnippet(text: string, maxLen = 60): string | null {
  const cleaned = stripSpeechWrappers(text).replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.substring(0, maxLen - 1).trimEnd() + "\u2026";
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

/**
 * Scan a session log once and compute summary metadata. Turn counts match the
 * semantics used by --tool-report (`generateSessionReport`): user turns count
 * entries with real text (not tool_result plumbing); assistant turns count
 * entries with text or tool_use.
 */
export async function getSessionMetadata(args: {
  sessionId: string;
  logPath: string;
}): Promise<SessionMetadata> {
  const fileStream = fs.createReadStream(args.logPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let startTime: Date | null = null;
  let endTime: Date | null = null;
  let userTurns = 0;
  let assistantTurns = 0;
  let toolCount = 0;
  let firstUserSnippet: string | null = null;

  for await (const line of rl) {
    if (!line.trim()) continue;

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    if (raw.type !== "user" && raw.type !== "assistant") continue;

    const message = raw.message as Record<string, unknown> | undefined;
    if (!message) continue;

    // Skip SDK meta prompts and synthetic assistant responses
    if (raw.isMeta === true) continue;
    if (raw.type === "assistant" && message.model === "<synthetic>") continue;

    const content = message.content;
    const blocks: Array<Record<string, unknown>> =
      typeof content === "string"
        ? [{ type: "text", text: content }]
        : Array.isArray(content)
          ? (content as Array<Record<string, unknown>>)
          : [];

    if (raw.type === "user") {
      const textBlocks = blocks.filter(
        (b) => b.type === "text" && b.text && String(b.text).trim()
      );
      if (textBlocks.length === 0) continue;
      const text = textBlocks.map((b) => String(b.text || "")).join("\n").trim();
      if (isPlumbingMessage(text) || isCompactionSummary(text)) continue;
      if (parseSelfNote(text)) continue;
      userTurns += 1;
      if (firstUserSnippet === null) firstUserSnippet = extractSnippet(text);
    } else {
      let hasVisible = false;
      for (const block of blocks) {
        if (block.type === "text" && block.text && String(block.text).trim()) {
          hasVisible = true;
        }
        if (block.type === "tool_use") {
          toolCount += 1;
          hasVisible = true;
        }
      }
      if (!hasVisible) continue;
      assistantTurns += 1;
    }

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
    userTurns,
    assistantTurns,
    toolCount,
    firstUserSnippet,
  };
}

/**
 * A "real" user message is one the human actually typed or spoke, as opposed
 * to system-injected user entries (tool results, schedule-fired notifications,
 * pending-schedules status, etc.). Real user messages start with a <typed> or
 * <speech> tag since the UI wraps human input in those.
 */
export function isRealUserMessage(entry: SessionEntry): boolean {
  if (entry.type !== "user") return false;
  for (const block of entry.content) {
    if (block.type !== "text") continue;
    const text = (block.text || "").trimStart();
    if (text.startsWith("<typed") || text.startsWith("<speech")) return true;
  }
  return false;
}

/**
 * Compute the minimum tail size that includes at least `minRealUserMessages`
 * real user messages. Returns the number of entries from the end of the list
 * needed to cover that many — or `entries.length` if fewer real user messages
 * exist than requested.
 */
export function tailForMinUserMessages(
  entries: SessionEntry[],
  minRealUserMessages: number,
): number {
  if (minRealUserMessages <= 0) return 0;
  let count = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isRealUserMessage(entries[i]!)) {
      count += 1;
      if (count >= minRealUserMessages) return entries.length - i;
    }
  }
  return entries.length;
}

/**
 * Parameters for parseSessionLog
 */
export interface ParseSessionLogParams {
  logPath: string;
  offset?: number;
  limit?: number;
}

/**
 * Parse a session log JSONL file with filtering and pagination.
 */
export async function parseSessionLog(
  params: ParseSessionLogParams
): Promise<{ entries: SessionEntry[]; total: number; hasMore: boolean }> {
  const { logPath, offset = 0, limit = 10000 } = params;
  const fileStream = fs.createReadStream(logPath, { encoding: "utf-8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const filtered: SessionEntry[] = [];

  for await (const line of rl) {
    if (!line.trim()) continue;

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }

    // Skip compact_boundary system messages — the compaction summary user
    // message that follows is the one we display
    if (raw.type === "system" && raw.subtype === "compact_boundary") continue;

    // Only keep user and assistant entries
    if (raw.type !== "user" && raw.type !== "assistant") continue;

    const message = raw.message as Record<string, unknown> | undefined;
    if (!message) continue;

    const content = transformContent(message.content);

    // Skip SDK meta prompts (e.g. "Continue from where you left off.") — internal wakeup plumbing
    if (raw.isMeta === true) continue;

    // Skip synthetic assistant responses (model === "<synthetic>") — generated locally, not by the LLM
    if (raw.type === "assistant" && message.model === "<synthetic>") continue;

    // Skip user entries that are API plumbing (tool_result blocks, "Tool loaded." etc.)
    if (raw.type === "user") {
      const textBlocks = content.filter(
        (block) => block.type === "text" && block.text?.trim()
      );
      if (textBlocks.length === 0) continue;
      const allPlumbing = textBlocks.every(
        (block) => isPlumbingMessage(block.text || "")
      );
      if (allPlumbing) continue;

      // Detect compaction summary messages (injected after context compaction)
      const firstText = textBlocks[0]?.text || "";
      if (isCompactionSummary(firstText)) {
        filtered.push({
          uuid: String(raw.uuid || ""),
          type: "compaction",
          timestamp: String(raw.timestamp || ""),
          content,
        });
        continue;
      }

      // Detect interrupted-turn markers
      if (firstText.trim() === "[Request interrupted by user]") {
        filtered.push({
          uuid: String(raw.uuid || ""),
          type: "interrupted",
          timestamp: String(raw.timestamp || ""),
          content: [],
        });
        continue;
      }
    }

    // Skip assistant entries with no visible content
    if (raw.type === "assistant" && content.length === 0) continue;

    // Extract user="..." and user-email="..." from <typed> or <speech> tags in user messages
    let user: string | undefined;
    let userEmail: string | undefined;
    if (raw.type === "user") {
      const firstText = content.find((b) => b.type === "text")?.text || "";
      const userMatch = firstText.match(/<(?:typed|speech)\b[^>]*\buser="([^"]*)"/);
      if (userMatch && userMatch[1]) {
        user = userMatch[1].replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
      }
      const emailMatch = firstText.match(/<(?:typed|speech)\b[^>]*\buser-email="([^"]*)"/);
      if (emailMatch && emailMatch[1]) {
        userEmail = emailMatch[1].replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
      }
    }

    filtered.push({
      uuid: String(raw.uuid || ""),
      type: raw.type as "user" | "assistant",
      timestamp: String(raw.timestamp || ""),
      content,
      ...(user ? { user } : {}),
      ...(userEmail ? { userEmail } : {}),
    });
  }

  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);

  return {
    entries: page,
    total,
    hasMore: offset + limit < total,
  };
}

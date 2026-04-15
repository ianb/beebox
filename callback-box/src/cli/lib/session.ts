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
  type: "text" | "tool_use" | "tool_result" | "thinking";
  text?: string;
  toolName?: string;
  toolId?: string;
  inputSummary?: string;
  /** Raw input from the tool_use block, for richer formatting in CLI */
  input?: Record<string, unknown>;
  toolUseId?: string;
  resultSummary?: string;
}

/**
 * Parsed session log entry.
 */
export interface SessionEntry {
  uuid: string;
  type: "user" | "assistant" | "compaction";
  timestamp: string;
  content: SessionContentBlock[];
  /** Display name of the sender (for user messages in multi-user chat) */
  user?: string;
  /** Email of the sender (for identity matching across devices) */
  userEmail?: string;
}

/**
 * Get the path to a Claude Code session log file.
 */
export function getSessionLogPath(boxRoot: string, sessionId: string): string {
  const encodedPath = boxRoot.replace(/\//g, "-");
  const claudeDir = path.join(os.homedir(), ".claude", "projects", encodedPath);
  return path.join(claudeDir, `${sessionId}.jsonl`);
}

/**
 * Get the Claude Code projects directory for a box.
 */
export function getSessionDir(boxRoot: string): string {
  const encodedPath = boxRoot.replace(/\//g, "-");
  return path.join(os.homedir(), ".claude", "projects", encodedPath);
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

    // Drop image blocks entirely — Claude Code's PDF-reading tools emit a
    // user-role turn with one image block per page to feed the model. These
    // are API plumbing, not user input; rendering them as "[image]" text
    // produces fake user messages in the chat UI.
    if (block.type === "image") continue;

    // Unknown block types: fall through with a placeholder so we don't
    // silently swallow something new. This is visible in the UI, which is
    // the point — we want to notice new block types.
    blocks.push({ type: "text", text: `[${String(block.type)}]` });
  }
  return blocks;
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

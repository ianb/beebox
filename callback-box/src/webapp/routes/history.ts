/**
 * History routes - Git commit timeline and session log viewer.
 */

import type { FastifyInstance } from "fastify";
import * as fs from "node:fs";
import * as readline from "node:readline";
import * as path from "node:path";
import * as os from "node:os";
import { getLogPaginated, getCommitDiff } from "../../cli/lib/git.js";

/**
 * Content block from a session log entry.
 */
interface SessionContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  toolName?: string;
  toolId?: string;
  inputSummary?: string;
  toolUseId?: string;
  resultSummary?: string;
}

/**
 * Parsed session log entry.
 */
interface SessionEntry {
  uuid: string;
  type: "user" | "assistant";
  timestamp: string;
  content: SessionContentBlock[];
}

/**
 * Get the path to a Claude Code session log file.
 */
function getSessionLogPath(boxRoot: string, sessionId: string): string {
  const encodedPath = boxRoot.replace(/\//g, "-");
  const claudeDir = path.join(os.homedir(), ".claude", "projects", encodedPath);
  return path.join(claudeDir, `${sessionId}.jsonl`);
}

/**
 * Summarize tool input for compact display.
 */
function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  if (!input) return "";

  switch (toolName) {
    case "Read":
      return String(input.file_path || "");
    case "Edit":
      return String(input.file_path || "");
    case "Write":
      return `${input.file_path} (${String(input.content || "").length} chars)`;
    case "Bash":
      return String(input.command || "").substring(0, 120);
    case "Glob":
      return String(input.pattern || "");
    case "Grep":
      return `${input.pattern} in ${input.path || "."}`;
    case "TodoWrite":
      return "update todos";
    default:
      return JSON.stringify(input).substring(0, 150);
  }
}

/**
 * Summarize tool result content for compact display.
 */
function summarizeToolResult(content: unknown): string {
  if (typeof content === "string") {
    return content.substring(0, 500);
  }
  if (Array.isArray(content)) {
    return content
      .map((c: unknown) => (typeof c === "string" ? c : (c as { text?: string })?.text || ""))
      .join("\n")
      .substring(0, 500);
  }
  return "";
}

/**
 * Transform raw message content into SessionContentBlocks.
 */
function transformContent(content: unknown): SessionContentBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  if (!Array.isArray(content)) return [];

  return content.map((block: Record<string, unknown>) => {
    if (block.type === "text") {
      return { type: "text" as const, text: String(block.text || "") };
    }

    if (block.type === "tool_use") {
      return {
        type: "tool_use" as const,
        toolName: String(block.name || ""),
        toolId: String(block.id || ""),
        inputSummary: summarizeToolInput(
          String(block.name || ""),
          (block.input || {}) as Record<string, unknown>
        ),
      };
    }

    if (block.type === "tool_result") {
      return {
        type: "tool_result" as const,
        toolUseId: String(block.tool_use_id || ""),
        resultSummary: summarizeToolResult(block.content),
      };
    }

    return { type: "text" as const, text: `[${block.type}]` };
  });
}

/**
 * Parameters for parseSessionLog
 */
interface ParseSessionLogParams {
  logPath: string;
  offset: number;
  limit: number;
}

/**
 * Parse a session log JSONL file with filtering and pagination.
 */
async function parseSessionLog(
  params: ParseSessionLogParams
): Promise<{ entries: SessionEntry[]; total: number; hasMore: boolean }> {
  const { logPath, offset, limit } = params;
  const fileStream = fs.createReadStream(logPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const filtered: SessionEntry[] = [];

  for await (const line of rl) {
    if (!line.trim()) continue;

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }

    // Only keep user and assistant entries
    if (raw.type !== "user" && raw.type !== "assistant") continue;

    const message = raw.message as Record<string, unknown> | undefined;
    if (!message) continue;

    const content = transformContent(message.content);

    // Skip user entries that only contain tool_result blocks (API plumbing, not real user messages)
    if (raw.type === "user") {
      const hasRealContent = content.some(
        (block) => block.type === "text" && block.text?.trim()
      );
      if (!hasRealContent) continue;
    }

    // Skip assistant entries with no visible content
    if (raw.type === "assistant" && content.length === 0) continue;

    filtered.push({
      uuid: String(raw.uuid || ""),
      type: raw.type as "user" | "assistant",
      timestamp: String(raw.timestamp || ""),
      content,
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

/**
 * Register history API routes.
 */
export async function registerHistoryRoutes(
  server: FastifyInstance,
  boxRoot: string
): Promise<void> {
  /**
   * GET /api/history - Paginated commit log with trailers.
   */
  server.get<{
    Querystring: { count?: string; offset?: string };
  }>("/api/history", async (request) => {
    const count = parseInt(request.query.count || "50", 10);
    const offset = parseInt(request.query.offset || "0", 10);

    const commits = await getLogPaginated({ boxRoot, count, offset });

    return { commits };
  });

  /**
   * GET /api/history/diff/:hash - Diff for a specific commit.
   */
  server.get<{
    Params: { hash: string };
  }>("/api/history/diff/:hash", async (request) => {
    const { hash } = request.params;

    // Validate hash looks like a git hash
    if (!/^[\da-f]{6,40}$/i.test(hash)) {
      return { hash, diff: "" };
    }

    const diff = await getCommitDiff(boxRoot, hash);
    return { hash, diff };
  });

  /**
   * GET /api/history/session/:sessionId - Parsed session log.
   */
  server.get<{
    Params: { sessionId: string };
    Querystring: { offset?: string; limit?: string };
  }>("/api/history/session/:sessionId", async (request) => {
    const { sessionId } = request.params;
    const offset = parseInt(request.query.offset || "0", 10);
    const limit = parseInt(request.query.limit || "100", 10);

    // Validate sessionId looks like a UUID
    if (!/^[\da-f-]{36}$/i.test(sessionId)) {
      return { sessionId, found: false, entries: [], total: 0, hasMore: false };
    }

    const logPath = getSessionLogPath(boxRoot, sessionId);

    // Check if file exists
    if (!fs.existsSync(logPath)) {
      return { sessionId, found: false, entries: [], total: 0, hasMore: false };
    }

    const result = await parseSessionLog({ logPath, offset, limit });

    return {
      sessionId,
      found: true,
      ...result,
    };
  });
}

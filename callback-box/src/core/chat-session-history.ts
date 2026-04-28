/**
 * chat-session-history — tracks which session ids belong to web chat for this box.
 *
 * Persisted at `.callback-box/chat-session-history.json`:
 *
 *   { "sessionIds": ["abc-123", ...], "migrated": true }
 *
 * The list drives the session dropdown — only sessions in here show up.
 * The `migrated` flag gates a one-shot backfill that scans existing JSONLs
 * for `<speech>`/`<typed>` user content and treats those as web chat sessions.
 *
 * Also owns the "most-active" pointer at `.callback-box/chat-session-id.json`,
 * which is what bare `/chat` (no session param) resolves to.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { createReadStream } from "node:fs";
import { listSessions } from "../cli/lib/session.js";

const HISTORY_FILE = ".callback-box/chat-session-history.json";
const MOST_ACTIVE_FILE = ".callback-box/chat-session-id.json";

interface HistoryFile {
  sessionIds: string[];
  migrated: boolean;
}

interface MostActiveFile {
  sessionId: string;
  savedAt: string;
}

function log(context: string, ...args: unknown[]): void {
  console.log(`[chat-history:${context}]`, ...args);
}

async function readHistoryFile(boxRoot: string): Promise<HistoryFile | null> {
  const filePath = path.join(boxRoot, HISTORY_FILE);
  try {
    const data = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(data) as Partial<HistoryFile>;
    return {
      sessionIds: Array.isArray(parsed.sessionIds) ? parsed.sessionIds : [],
      migrated: parsed.migrated === true,
    };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    log("read", `Failed to read history file: ${err.message}`);
    return null;
  }
}

async function writeHistoryFile(boxRoot: string, contents: HistoryFile): Promise<void> {
  const filePath = path.join(boxRoot, HISTORY_FILE);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(contents, null, 2));
}

/**
 * Load the list of web chat session ids known to this box.
 */
export async function loadHistory(boxRoot: string): Promise<string[]> {
  const file = await readHistoryFile(boxRoot);
  if (file === null) return [];
  return file.sessionIds;
}

/**
 * Append a session id to the history. Idempotent — duplicates are ignored.
 */
export async function appendHistory(boxRoot: string, sessionId: string): Promise<void> {
  const file = (await readHistoryFile(boxRoot)) ?? { sessionIds: [], migrated: false };
  if (file.sessionIds.includes(sessionId)) return;
  file.sessionIds.push(sessionId);
  await writeHistoryFile(boxRoot, file);
}

/**
 * Read the most-active session pointer (the session bare `/chat` resolves to).
 */
export async function getMostActive(boxRoot: string): Promise<string | null> {
  const filePath = path.join(boxRoot, MOST_ACTIVE_FILE);
  try {
    const data = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(data) as Partial<MostActiveFile>;
    return typeof parsed.sessionId === "string" ? parsed.sessionId : null;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    log("most-active", `Failed to read most-active file: ${err.message}`);
    return null;
  }
}

/**
 * Update the most-active session pointer. Called whenever a session is
 * meaningfully used (send, restart, reset).
 */
export async function setMostActive(boxRoot: string, sessionId: string): Promise<void> {
  const filePath = path.join(boxRoot, MOST_ACTIVE_FILE);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const contents: MostActiveFile = {
    sessionId,
    savedAt: new Date().toISOString(),
  };
  await fs.writeFile(filePath, JSON.stringify(contents, null, 2));
}

/**
 * Detect whether a session log contains web-chat user input (`<speech>` or
 * `<typed>` tags). Streams the file and returns on first match.
 */
async function logHasWebChatMarkers(logPath: string): Promise<boolean> {
  const fileStream = createReadStream(logPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let raw: { type?: string; message?: { content?: unknown } };
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }
      if (raw.type !== "user") continue;
      const content = raw.message?.content;
      const blocks: Array<{ type?: string; text?: string }> =
        typeof content === "string"
          ? [{ type: "text", text: content }]
          : Array.isArray(content)
            ? (content as Array<{ type?: string; text?: string }>)
            : [];
      for (const block of blocks) {
        if (block.type !== "text" || typeof block.text !== "string") continue;
        if (block.text.includes("<speech") || block.text.includes("<typed")) {
          return true;
        }
      }
    }
  } finally {
    rl.close();
    fileStream.destroy();
  }
  return false;
}

/**
 * One-shot scan that adds any pre-existing web chat sessions to the history
 * file, then sets `migrated: true` so it never runs again.
 *
 * Identifies "web chat" by scanning each JSONL for user messages containing
 * `<speech>` or `<typed>` markers.
 */
export async function runBackfillIfNeeded(boxRoot: string): Promise<void> {
  const file = (await readHistoryFile(boxRoot)) ?? { sessionIds: [], migrated: false };
  if (file.migrated) return;

  log("backfill", "Scanning JSONLs for web chat sessions");
  const sessions = await listSessions(boxRoot);
  const known = new Set(file.sessionIds);
  let added = 0;
  for (const s of sessions) {
    if (known.has(s.sessionId)) continue;
    try {
      if (await logHasWebChatMarkers(s.path)) {
        file.sessionIds.push(s.sessionId);
        known.add(s.sessionId);
        added += 1;
      }
    } catch (e) {
      log("backfill", `Failed to scan ${s.path}: ${e instanceof Error ? e.message : e}`);
    }
  }
  file.migrated = true;
  await writeHistoryFile(boxRoot, file);
  log("backfill", `Done — added ${added} session(s)`);
}

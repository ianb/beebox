/**
 * chat-session-history — tracks which session ids belong to web chat for
 * this box, and (optionally) which directory each one is "associated with"
 * via a landmark.
 *
 * Persisted at `.callback-box/chat-session-history.json`. The format
 * evolved from a flat string array to per-session entries:
 *
 *   v1 (legacy): { "sessionIds": ["abc-123", ...], "migrated": true }
 *   v2 (current): { "sessions": [{ "id": "abc-123", "contextDir": "store/recipes" }, ...], "migrated": true }
 *
 * v1 files are auto-converted on first read. The list drives the session
 * dropdown — only sessions in here show up.
 *
 * The `migrated` flag gates a one-shot backfill that scans existing
 * JSONLs for `<speech>`/`<typed>` user content and treats those as web
 * chat sessions.
 *
 * Also owns the "most-active" pointer at `.callback-box/chat-session-id.json`,
 * which is what bare `/chat` (no session param) resolves to.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { createReadStream } from "node:fs";
import { listSessions, getSessionLogPath } from "../cli/lib/session.js";

const HISTORY_FILE = ".callback-box/chat-session-history.json";
const MOST_ACTIVE_FILE = ".callback-box/chat-session-id.json";

export interface SessionHistoryEntry {
  id: string;
  /** Directory this chat is associated with (from a landmark). Undefined for unassociated chats. */
  contextDir?: string;
  /**
   * Chat feature flags for this session (see `chat-features.ts`). Missing
   * keys take the registry default. Missing field entirely means "all
   * defaults" — backwards-compatible with pre-feature sessions.
   */
  features?: Record<string, string>;
}

interface HistoryFile {
  sessions: SessionHistoryEntry[];
  migrated: boolean;
}

interface MostActiveFile {
  sessionId: string;
  savedAt: string;
}

function log(context: string, ...args: unknown[]): void {
  console.log(`[chat-history:${context}]`, ...args);
}

/**
 * Narrow a single entry from the persisted JSON into a SessionHistoryEntry.
 * Returns null if the value doesn't look like an entry (missing or non-string
 * id). All field reads use `in`-operator narrowing so the function avoids
 * type-casts on untrusted input.
 */
function parseSessionEntry(raw: unknown): SessionHistoryEntry | null {
  if (raw === null || typeof raw !== "object") return null;
  if (!("id" in raw) || typeof raw.id !== "string") return null;
  const entry: SessionHistoryEntry = { id: raw.id };
  if ("contextDir" in raw && typeof raw.contextDir === "string" && raw.contextDir.length > 0) {
    entry.contextDir = raw.contextDir;
  }
  if ("features" in raw && raw.features !== null && typeof raw.features === "object" && !Array.isArray(raw.features)) {
    const sanitized: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.features)) {
      if (typeof v === "string") sanitized[k] = v;
    }
    if (Object.keys(sanitized).length > 0) entry.features = sanitized;
  }
  return entry;
}

async function readHistoryFile(boxRoot: string): Promise<HistoryFile | null> {
  const filePath = path.join(boxRoot, HISTORY_FILE);
  try {
    const data = await fs.readFile(filePath, "utf-8");
    // The file is read in two compatible shapes — v1 had `sessionIds`,
    // v2 has `sessions`. Tolerate either, and let the next write upgrade.
    const parsed = JSON.parse(data) as {
      sessions?: unknown;
      sessionIds?: unknown;
      migrated?: unknown;
    };
    const sessions: SessionHistoryEntry[] = [];
    if (Array.isArray(parsed.sessions)) {
      for (const raw of parsed.sessions) {
        const entry = parseSessionEntry(raw);
        if (entry) sessions.push(entry);
      }
    } else if (Array.isArray(parsed.sessionIds)) {
      for (const id of parsed.sessionIds) {
        if (typeof id === "string") sessions.push({ id });
      }
    }
    return { sessions, migrated: parsed.migrated === true };
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
  return file.sessions.map((s) => s.id);
}

/**
 * Load the full per-session entries (id + optional contextDir).
 */
export async function loadHistoryEntries(boxRoot: string): Promise<SessionHistoryEntry[]> {
  const file = await readHistoryFile(boxRoot);
  if (file === null) return [];
  return file.sessions;
}

interface AppendHistoryOptions {
  sessionId: string;
  /**
   * Directory this chat is associated with. A non-empty path means the
   * chat is bound to a landmark subdirectory; an empty string means the
   * chat is bound to the box root. Omit entirely for legacy unbound
   * sessions (the picker treats those as root-bound).
   */
  contextDir?: string;
}

/**
 * Append a session id to the history. Idempotent — duplicates are ignored.
 */
export async function appendHistory(
  boxRoot: string,
  opts: AppendHistoryOptions,
): Promise<void> {
  const file = (await readHistoryFile(boxRoot)) ?? { sessions: [], migrated: false };
  const existing = file.sessions.find((s) => s.id === opts.sessionId);
  if (existing) {
    // Fill in a binding if the entry didn't have one yet — empty string
    // ("root-bound") is just as much a binding as a real subdirectory.
    if (opts.contextDir !== undefined && existing.contextDir === undefined) {
      existing.contextDir = opts.contextDir;
      await writeHistoryFile(boxRoot, file);
    }
    return;
  }
  const entry: SessionHistoryEntry = { id: opts.sessionId };
  if (opts.contextDir !== undefined) entry.contextDir = opts.contextDir;
  file.sessions.push(entry);
  await writeHistoryFile(boxRoot, file);
}

/**
 * Look up the directory a session is associated with. Returns the
 * recorded `contextDir` if any — note that an empty string is a real
 * binding (the box-root landmark) and is distinguished from `null`
 * (no entry, or entry has no binding recorded).
 */
export async function getDirectoryForSession(
  boxRoot: string,
  sessionId: string,
): Promise<string | null> {
  const entries = await loadHistoryEntries(boxRoot);
  const entry = entries.find((s) => s.id === sessionId);
  if (!entry || entry.contextDir === undefined) return null;
  return entry.contextDir;
}

/**
 * Resolve where a session's JSONL lives on disk. A landmark-bound chat
 * runs the SDK with `cwd = boxRoot/<contextDir>`, so its log sits under
 * the cwd-encoded `~/.claude/projects/<dir>/` rather than the box-root
 * one. Empty-string / null contextDir means a root-bound chat — log at
 * the box-root path.
 */
export async function resolveSessionLogPath(
  boxRoot: string,
  sessionId: string,
): Promise<string> {
  const contextDir = await getDirectoryForSession(boxRoot, sessionId);
  if (contextDir === null || contextDir === "") return getSessionLogPath(boxRoot, sessionId);
  return getSessionLogPath(path.join(boxRoot, contextDir), sessionId);
}

/**
 * Find the most-recently-created session associated with a directory.
 * "Most recent" means later in the history file's session list — entries
 * are appended in creation order, so the last match wins.
 *
 * Pre-landmark sessions have no recorded `contextDir`. They're treated
 * as box-root chats, so a query for `""` (the root binding) matches
 * both empty-string entries and entries with no `contextDir` at all.
 */
export async function getLastSessionForDirectory(
  boxRoot: string,
  contextDir: string,
): Promise<string | null> {
  const entries = await loadHistoryEntries(boxRoot);
  // Walk newest → oldest and skip ghost entries — history rows are written
  // when the SDK first assigns an id (before any output is committed), so a
  // turn that errors immediately leaves an entry pointing at a JSONL that
  // never gets created. Returning the ghost id sends the user to a chat the
  // SDK can't resume and silently fails. fs.access is cheap relative to
  // user-facing latency on a "Chat" click.
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (!entry) continue;
    const matches = entry.contextDir === contextDir
      || (contextDir === "" && entry.contextDir === undefined);
    if (!matches) continue;
    const logPath = await resolveSessionLogPath(boxRoot, entry.id);
    try {
      await fs.access(logPath);
      return entry.id;
    } catch {
      // Ghost entry — no log on disk. Skip and keep looking. Logged so a
      // recurring ghost-creation bug shows up as repeated skips for the
      // same id across sessions.
      console.warn(`[chat-session-history] Skipping ghost entry for ${contextDir === "" ? "<root>" : contextDir}: ${entry.id} (no JSONL at ${logPath})`);
      continue;
    }
  }
  return null;
}

/**
 * Read the feature map persisted for a session, or null if no entry
 * exists (or the entry has no features field — which means "use
 * defaults"). The caller is expected to merge with registry defaults.
 */
export async function getFeaturesForSession(
  boxRoot: string,
  sessionId: string,
): Promise<Record<string, string> | null> {
  const entries = await loadHistoryEntries(boxRoot);
  const entry = entries.find((s) => s.id === sessionId);
  if (!entry || !entry.features) return null;
  return { ...entry.features };
}

/**
 * Persist feature-map updates for a session. Creates the entry if it
 * doesn't exist yet — handy when features are toggled before the first
 * message has assigned a session id. Caller passes only the keys it
 * wants to change; existing keys not in `updates` are preserved.
 */
export async function updateFeaturesForSession(
  boxRoot: string,
  opts: { sessionId: string; updates: Record<string, string> },
): Promise<void> {
  const { sessionId, updates } = opts;
  const file = (await readHistoryFile(boxRoot)) ?? { sessions: [], migrated: false };
  let entry = file.sessions.find((s) => s.id === sessionId);
  if (!entry) {
    entry = { id: sessionId };
    file.sessions.push(entry);
  }
  const merged: Record<string, string> = { ...(entry.features ?? {}) };
  for (const [k, v] of Object.entries(updates)) merged[k] = v;
  entry.features = merged;
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
  const file = (await readHistoryFile(boxRoot)) ?? { sessions: [], migrated: false };
  if (file.migrated) return;

  log("backfill", "Scanning JSONLs for web chat sessions");
  const sessions = await listSessions(boxRoot);
  const known = new Set(file.sessions.map((s) => s.id));
  let added = 0;
  for (const s of sessions) {
    if (known.has(s.sessionId)) continue;
    try {
      if (await logHasWebChatMarkers(s.path)) {
        file.sessions.push({ id: s.sessionId });
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

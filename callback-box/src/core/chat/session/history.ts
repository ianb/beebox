/**
 * chat-session-history — tracks which native session ids belong to web chat for
 * this box, and (optionally) which directory each one is "associated with"
 * via a landmark.
 *
 * Persisted at `.callback-box/chat-session-history.json`. The format
 * evolved from a flat string array to per-session entries:
 *
 *   v1 (legacy): { "sessionIds": ["abc-123", ...], "migrated": true }
 *   v2: { "sessions": [{ "id": "abc-123", "contextDir": "store/recipes" }, ...], "migrated": true }
 *   v3 (current): adds `engine`; a missing value decodes as `claude`
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

import { makeLog } from "./log.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getSessionDir, getSessionLogPath } from "./transcript-paths.js";
import { errnoCode, errorMessage } from "../../../lib/error-guards.js";
import { isRecord } from "../../card-io.js";
import { writeFileAtomic } from "../../../lib/atomic-write.js";
import { withCardLock } from "../../../lib/card-lock.js";
import { loadAgentEngine, type AgentEngine } from "../../box/config.js";
import { readCodexSessionUpdatedAt } from "./codex-transcript.js";

const HISTORY_FILE = ".callback-box/chat-session-history.json";
const MOST_ACTIVE_FILE = ".callback-box/chat-session-id.json";

export interface SessionHistoryEntry {
  id: string;
  /** Native harness that owns this session. Missing on disk means Claude. */
  engine: AgentEngine;
  /** Directory this chat is associated with (from a landmark). Undefined for unassociated chats. */
  contextDir?: string;
  /**
   * Chat feature flags for this session (see `chat-features.ts`). Missing
   * keys take the registry default. Missing field entirely means "all
   * defaults" — backwards-compatible with pre-feature sessions.
   */
  features?: Record<string, string>;
}

export interface HistoryFile {
  sessions: SessionHistoryEntry[];
  migrated: boolean;
}

export interface MostActiveFile {
  sessionId: string | null;
  savedAt: string;
}

const log = makeLog("chat-history");

class MalformedChatHistoryError extends Error {
  constructor() {
    super("Chat session history is malformed");
    this.name = "MalformedChatHistoryError";
  }
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
  const engine = "engine" in raw ? raw.engine : "claude";
  if (engine !== "claude" && engine !== "codex") return null;
  const entry: SessionHistoryEntry = { id: raw.id, engine };
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

/**
 * Read the raw history file (both writers — this module and backfill.ts —
 * go through this and writeHistoryFile; nothing else should).
 */
export async function readHistoryFile(boxRoot: string, options?: { strict?: boolean }): Promise<HistoryFile | null> {
  const filePath = path.join(boxRoot, HISTORY_FILE);
  try {
    const data = await fs.readFile(filePath, "utf-8");
    // The file is read in two compatible shapes — v1 had `sessionIds`,
    // v2 has `sessions`. Tolerate either, and let the next write upgrade.
    const parsedRaw: unknown = JSON.parse(data);
    if (!isRecord(parsedRaw) && options?.strict === true) throw new MalformedChatHistoryError();
    const parsed = isRecord(parsedRaw) ? parsedRaw : {};
    const sessions: SessionHistoryEntry[] = [];
    if (Array.isArray(parsed.sessions)) {
      for (const raw of parsed.sessions) {
        const entry = parseSessionEntry(raw);
        if (entry) sessions.push(entry);
        else if (options?.strict === true) throw new MalformedChatHistoryError();
      }
    } else if (Array.isArray(parsed.sessionIds)) {
      for (const id of parsed.sessionIds) {
        if (typeof id === "string") sessions.push({ id, engine: "claude" });
        else if (options?.strict === true) throw new MalformedChatHistoryError();
      }
    } else if (options?.strict === true && ("sessions" in parsed || "sessionIds" in parsed)) {
      throw new MalformedChatHistoryError();
    }
    return { sessions, migrated: parsed.migrated === true };
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    if (options?.strict === true) throw e;
    log("read", `Failed to read history file: ${errorMessage(e)}`);
    return null;
  }
}

export async function writeHistoryFile(boxRoot: string, contents: HistoryFile): Promise<void> {
  const filePath = path.join(boxRoot, HISTORY_FILE);
  await writeFileAtomic(filePath, {
    content: JSON.stringify(contents, null, 2),
  });
}

/** Serialize a complete history read-modify-write operation. */
export function withHistoryLock<T>(boxRoot: string, fn: () => Promise<T>): Promise<T> {
  return withCardLock(path.join(boxRoot, HISTORY_FILE), fn);
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

/** One encoded `~/.claude/projects/` directory a box's sessions may live in. */
export interface SessionRoot {
  /** Box-relative context dir ("" = the box root itself). */
  contextDir: string;
  /** Absolute path of the encoded projects directory for that cwd. */
  dir: string;
}

/**
 * Every `~/.claude/projects/` directory this box's sessions can live in:
 * the box root first, then one per distinct `contextDir` recorded in the
 * session history (landmark-bound chats run the SDK with cwd set to the
 * subdirectory, so their transcripts land under a different encoded dir).
 * Deduped by encoded dir name and filtered to dirs that exist on disk —
 * except the box-root entry, which is always returned so callers have at
 * least one root to probe and report.
 */
export async function listSessionRoots(boxRoot: string): Promise<SessionRoot[]> {
  const boxRootDir = getSessionDir(boxRoot);
  const roots: SessionRoot[] = [{ contextDir: "", dir: boxRootDir }];
  const seen = new Set<string>([path.basename(boxRootDir)]);
  const entries = await loadHistoryEntries(boxRoot);
  for (const entry of entries) {
    const contextDir = entry.contextDir;
    if (contextDir === undefined || contextDir === "") continue;
    const dir = getSessionDir(path.join(boxRoot, contextDir));
    const encoded = path.basename(dir);
    if (seen.has(encoded)) continue;
    seen.add(encoded);
    try {
      await fs.access(dir);
    } catch (_e) {
      // Landmark dir has no transcripts on disk (all its sessions were
      // cleaned up, or the entry is a ghost) — nothing to list there.
      continue;
    }
    roots.push({ contextDir, dir });
  }
  return roots;
}

interface AppendHistoryOptions {
  sessionId: string;
  engine?: AgentEngine;
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
export async function appendHistory(boxRoot: string, opts: AppendHistoryOptions): Promise<void> {
  await withHistoryLock(boxRoot, async () => {
    const file = (await readHistoryFile(boxRoot)) ?? {
      sessions: [],
      migrated: false,
    };
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
    const entry: SessionHistoryEntry = { id: opts.sessionId, engine: opts.engine ?? await loadAgentEngine(boxRoot) };
    if (opts.contextDir !== undefined) entry.contextDir = opts.contextDir;
    file.sessions.push(entry);
    await writeHistoryFile(boxRoot, file);
  });
}


/** Remove every exact matching history entry. Returns the removed entries. */
export async function removeSessionFromHistory(boxRoot: string, sessionId: string): Promise<SessionHistoryEntry[]> {
  return withHistoryLock(boxRoot, async () => {
    const file = await readHistoryFile(boxRoot, { strict: true });
    if (file === null) return [];
    const removed = file.sessions.filter((entry) => entry.id === sessionId);
    if (removed.length === 0) return [];
    file.sessions = file.sessions.filter((entry) => entry.id !== sessionId);
    await writeHistoryFile(boxRoot, file);
    return removed;
  });
}

/** Restore removed entries without overwriting history written by other sessions. */
export async function restoreSessionHistoryEntries(boxRoot: string, entries: SessionHistoryEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await withHistoryLock(boxRoot, async () => {
    const file = (await readHistoryFile(boxRoot, { strict: true })) ?? {
      sessions: [],
      migrated: false,
    };
    const existing = new Set(file.sessions.map((entry) => entry.id));
    for (const entry of entries) {
      if (!existing.has(entry.id)) file.sessions.push(entry);
    }
    await writeHistoryFile(boxRoot, file);
  });
}

/**
 * Look up the directory a session is associated with. Returns the
 * recorded `contextDir` if any — note that an empty string is a real
 * binding (the box-root landmark) and is distinguished from `null`
 * (no entry, or entry has no binding recorded).
 */
export async function getDirectoryForSession(boxRoot: string, sessionId: string): Promise<string | null> {
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
export async function resolveSessionLogPath(boxRoot: string, sessionId: string): Promise<string> {
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
export async function getLastSessionForDirectory(boxRoot: string, contextDir: string): Promise<string | null> {
  const entries = await loadHistoryEntries(boxRoot);
  // Walk newest → oldest and skip ghost entries — history rows are written
  // when the SDK first assigns an id (before any output is committed), so a
  // turn that errors immediately leaves an entry pointing at a JSONL that
  // never gets created. Returning the ghost id sends the user to a chat the
  // SDK can't resume and silently fails. fs.access is cheap relative to
  // user-facing latency on a "Chat" click.
  //
  // Testing caveat: this means tests that exercise this helper can't just
  // call appendHistory — they must also seed an empty JSONL at the path
  // resolveSessionLogPath() produces, or every entry looks like a ghost and
  // the helper returns null. See test/core/chat-session-history.doctest.md's
  // seedSessionLog/cleanupSessionLogs helpers.
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (!entry) continue;
    const matches = entry.contextDir === contextDir || (contextDir === "" && entry.contextDir === undefined);
    if (!matches) continue;
    try {
      if (entry.engine === "codex") await readCodexSessionUpdatedAt(boxRoot, entry.id);
      else await fs.access(await resolveSessionLogPath(boxRoot, entry.id));
      return entry.id;
    } catch (_e) {
      // Ghost entry — no log on disk. The fs.access rejection only tells us
      // the file is absent (which is the signal we want), so we ignore the
      // error object itself and log our own contextual warning instead. A
      // recurring ghost-creation bug shows up as repeated skips for the
      // same id across sessions.
      console.warn(`[chat-session-history] Skipping ghost ${entry.engine} entry for ${contextDir === "" ? "<root>" : contextDir}: ${entry.id}`);
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
export async function getFeaturesForSession(boxRoot: string, sessionId: string): Promise<Record<string, string> | null> {
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
export async function updateFeaturesForSession(boxRoot: string, opts: { sessionId: string; updates: Record<string, string> }): Promise<void> {
  await withHistoryLock(boxRoot, async () => {
    const { sessionId, updates } = opts;
    const file = (await readHistoryFile(boxRoot)) ?? {
      sessions: [],
      migrated: false,
    };
    let entry = file.sessions.find((s) => s.id === sessionId);
    if (!entry) {
      entry = { id: sessionId, engine: await loadAgentEngine(boxRoot) };
      file.sessions.push(entry);
    }
    const merged: Record<string, string> = { ...(entry.features ?? {}) };
    for (const [k, v] of Object.entries(updates)) merged[k] = v;
    entry.features = merged;
    await writeHistoryFile(boxRoot, file);
  });
}

/**
 * Read the most-active session pointer (the session bare `/chat` resolves to).
 */
export async function getMostActive(boxRoot: string): Promise<string | null> {
  const filePath = path.join(boxRoot, MOST_ACTIVE_FILE);
  try {
    const data = await fs.readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(data);
    return isRecord(parsed) && typeof parsed.sessionId === "string" ? parsed.sessionId : null;
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    log("most-active", `Failed to read most-active file: ${errorMessage(e)}`);
    return null;
  }
}

/**
 * Read when the most-active pointer was last written — i.e. the last
 * time any chat session on this box saw real activity. Powers the
 * snapshot's `last-activity` attribute. Returns null when there's no
 * pointer yet or its savedAt doesn't parse.
 */
export async function getMostActiveSavedAt(boxRoot: string): Promise<Date | null> {
  const filePath = path.join(boxRoot, MOST_ACTIVE_FILE);
  try {
    const data = await fs.readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(data);
    if (!isRecord(parsed) || typeof parsed.savedAt !== "string") return null;
    const savedAt = new Date(parsed.savedAt);
    return Number.isNaN(savedAt.getTime()) ? null : savedAt;
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    log("most-active", `Failed to read most-active savedAt: ${errorMessage(e)}`);
    return null;
  }
}

/**
 * Update the most-active session pointer. Called whenever a session is
 * meaningfully used (send, restart, reset).
 */
export async function setMostActive(boxRoot: string, sessionId: string): Promise<void> {
  const filePath = path.join(boxRoot, MOST_ACTIVE_FILE);
  await withCardLock(filePath, async () => {
    const contents: MostActiveFile = {
      sessionId,
      savedAt: new Date().toISOString(),
    };
    await writeFileAtomic(filePath, {
      content: JSON.stringify(contents, null, 2),
    });
  });
}

/** Clear the most-active id only when it still names `sessionId`. */
export async function clearMostActiveIfMatches(boxRoot: string, sessionId: string): Promise<MostActiveFile | null> {
  const filePath = path.join(boxRoot, MOST_ACTIVE_FILE);
  return withCardLock(filePath, async () => {
    let previous: MostActiveFile;
    try {
      const raw: unknown = JSON.parse(await fs.readFile(filePath, "utf-8"));
      if (!isRecord(raw) || raw.sessionId !== sessionId || typeof raw.savedAt !== "string") return null;
      previous = { sessionId, savedAt: raw.savedAt };
    } catch (error) {
      if (errnoCode(error) === "ENOENT") return null;
      throw error;
    }
    await writeFileAtomic(filePath, {
      content: JSON.stringify({ sessionId: null, savedAt: previous.savedAt }, null, 2),
    });
    return previous;
  });
}

/** Restore a cleared pointer only if no newer session has claimed it. */
export async function restoreMostActiveIfEmpty(boxRoot: string, previous: MostActiveFile | null): Promise<void> {
  if (previous === null) return;
  const filePath = path.join(boxRoot, MOST_ACTIVE_FILE);
  await withCardLock(filePath, async () => {
    let current: unknown = null;
    try {
      current = JSON.parse(await fs.readFile(filePath, "utf-8"));
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error;
    }
    if (isRecord(current) && typeof current.sessionId === "string") return;
    await writeFileAtomic(filePath, {
      content: JSON.stringify(previous, null, 2),
    });
  });
}

/**
 * Chat husks — a `chat` card per web chat session (docs/plans/chat-husks.md).
 *
 * The husk is the session's noun: identity (`session` id, `context-dir`)
 * plus editorial fields, created eagerly at session-id assignment and
 * backfilled once for pre-husk history. Activity/freshness deliberately
 * stays in runtime bookkeeping — the card never changes just because the
 * conversation continued.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { splitCardContent } from "../../cards/index.js";
import { createChatHuskTemplate } from "../../schemas/chat.js";
import { loadHistoryEntries, resolveSessionLogPath } from "./session/history.js";
import { getSessionMetadata } from "../../cli/lib/session.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";

export const CHAT_HUSK_DIR = "store/chat/web";
const BACKFILL_MARKER = ".callback-box/chat-husks-backfilled";
/** Keep husk titles bookmark-sized, not transcript-sized. */
const TITLE_MAX_LEN = 80;

function shortId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

/** `2026-07-02_59fc20dd.chat.card` — date names the file; the suffix is the idempotency key. */
function huskFileName(sessionId: string, date: Date): string {
  return `${date.toISOString().slice(0, 10)}_${shortId(sessionId)}.chat.card`;
}

/**
 * Find an existing husk for a session, by the `_<shortid>.chat.card`
 * filename suffix (rename-tolerant as long as the suffix survives; a
 * fully renamed husk is fine too — it just won't be found here, and
 * ensure would create a duplicate pointer, which validation of the
 * `session` field makes discoverable rather than harmful).
 */
export async function findChatHusk(boxRoot: string, sessionId: string): Promise<string | null> {
  const suffix = `_${shortId(sessionId)}.chat.card`;
  let names: string[];
  try {
    names = await fs.readdir(path.join(boxRoot, CHAT_HUSK_DIR));
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
  const match = names.find((n) => n.endsWith(suffix));
  return match === undefined ? null : `${CHAT_HUSK_DIR}/${match}`;
}

/** Best-effort title from the transcript's first user message; null when unavailable. */
async function readSnippetTitle(boxRoot: string, sessionId: string): Promise<string | null> {
  try {
    const logPath = await resolveSessionLogPath(boxRoot, sessionId);
    const meta = await getSessionMetadata({ sessionId, logPath, snippetMaxLen: TITLE_MAX_LEN });
    const snippet = meta.firstUserSnippet?.trim();
    return snippet !== undefined && snippet !== "" ? snippet : null;
  } catch (_e) {
    // No transcript yet (brand-new session) or unreadable — the husk starts
    // untitled; enrichment is editorial, not plumbing.
    return null;
  }
}

/**
 * Ensure a husk card exists for a session; returns its box-relative path.
 * Idempotent. `date` names the file (defaults to now; backfill passes the
 * transcript mtime so old husks sort by when the chat happened).
 */
export async function ensureChatHusk(
  boxRoot: string,
  opts: { sessionId: string; contextDir?: string; date?: Date },
): Promise<string> {
  const existing = await findChatHusk(boxRoot, opts.sessionId);
  if (existing !== null) return existing;

  const title = await readSnippetTitle(boxRoot, opts.sessionId);
  const relPath = `${CHAT_HUSK_DIR}/${huskFileName(opts.sessionId, opts.date ?? new Date())}`;
  const absPath = path.join(boxRoot, relPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const content = createChatHuskTemplate({
    session: opts.sessionId,
    ...(opts.contextDir !== undefined ? { contextDir: opts.contextDir } : {}),
    ...(title !== null ? { title } : {}),
  });
  // `wx` so a concurrent ensure can't clobber; losing the race is success.
  try {
    await fs.writeFile(absPath, content, { flag: "wx" });
  } catch (e) {
    if (errnoCode(e) !== "EEXIST") throw e;
  }
  return relPath;
}

/** Frontmatter mapping from a husk file, or null when the shape is wrong. */
function parseHuskFrontmatter(content: string): Record<string, unknown> | null {
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return null;
  let parsed: unknown;
  try {
    parsed = parseYaml(split.frontmatterText);
  } catch (_e) {
    // Malformed YAML — reported by the caller as a skipped husk.
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

export interface ChatHuskEntry {
  /** Box-relative husk card path. */
  path: string;
  /** SDK session id (the `session` field). */
  session: string;
  contextDir?: string;
  title?: string;
}

/**
 * All husk cards under store/chat/web — the enumeration source for
 * "which web chats exist" (the picker reads these, not the history
 * JSON, so deleting a husk is editorial removal from the picker).
 * Unparseable or session-less files are skipped with a warning.
 */
export async function listChatHusks(boxRoot: string): Promise<ChatHuskEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(path.join(boxRoot, CHAT_HUSK_DIR));
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }
  const out: ChatHuskEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".chat.card")) continue;
    const relPath = `${CHAT_HUSK_DIR}/${name}`;
    let content: string;
    try {
      content = await fs.readFile(path.join(boxRoot, relPath), "utf-8");
    } catch (e) {
      console.warn(`chat-husk: skipping unreadable ${relPath}: ${errorMessage(e)}`);
      continue;
    }
    const fm = parseHuskFrontmatter(content);
    if (fm === null) {
      console.warn(`chat-husk: skipping ${relPath}: no frontmatter mapping`);
      continue;
    }
    const session = fm["session"];
    if (typeof session !== "string" || session === "") {
      console.warn(`chat-husk: skipping ${relPath}: no session field`);
      continue;
    }
    const contextDir = fm["context-dir"];
    const title = fm["title"];
    out.push({
      path: relPath,
      session,
      ...(typeof contextDir === "string" ? { contextDir } : {}),
      ...(typeof title === "string" && title !== "" ? { title } : {}),
    });
  }
  return out;
}

/**
 * One-shot husk backfill for pre-husk sessions in the history file.
 * Ghost entries (no transcript on disk) are skipped — nothing to point
 * at. Gated by a marker file; safe to call on every server boot.
 */
export async function backfillChatHusks(boxRoot: string): Promise<void> {
  const marker = path.join(boxRoot, BACKFILL_MARKER);
  try {
    await fs.access(marker);
    return;
  } catch (_e) {
    // Marker absent — this is the run.
  }
  const entries = await loadHistoryEntries(boxRoot);
  for (const entry of entries) {
    let mtime: Date;
    try {
      const logPath = await resolveSessionLogPath(boxRoot, entry.id);
      mtime = (await fs.stat(logPath)).mtime;
    } catch (_e) {
      // Ghost entry — transcript gone; no husk.
      continue;
    }
    await ensureChatHusk(boxRoot, {
      sessionId: entry.id,
      ...(entry.contextDir !== undefined ? { contextDir: entry.contextDir } : {}),
      date: mtime,
    });
  }
  await fs.mkdir(path.dirname(marker), { recursive: true });
  await fs.writeFile(marker, `${new Date().toISOString()}\n`);
}

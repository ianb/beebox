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
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import { isRecord } from "../card-io.js";
import { mapInBatchesSettled } from "../../lib/map-batched.js";
import { readCodexSessionUpdatedAt } from "./session/codex-transcript.js";
import { loadSessionHistory } from "./session/load-history.js";

/** Husk cards read at once — see {@link mapInBatchesSettled}. */
const READ_CONCURRENCY = 64;

export const CHAT_HUSK_DIR = "store/chat/web";
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
    const { entries } = await loadSessionHistory(boxRoot, {
      sessionId,
      slice: { mode: "page", offset: 0, limit: 100 },
    });
    const text = entries.find((entry) => entry.type === "user")?.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    return text === undefined || text === "" ? null : text.slice(0, TITLE_MAX_LEN);
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
export async function ensureChatHusk(boxRoot: string, opts: { sessionId: string; contextDir?: string; date?: Date }): Promise<string> {
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
  return isRecord(parsed) ? parsed : null;
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
  return listChatHusksUnder(boxRoot, CHAT_HUSK_DIR);
}

/** Read chat cards directly under a box-relative directory (active or Trash). */
export async function listChatHusksUnder(boxRoot: string, relDir: string): Promise<ChatHuskEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(path.join(boxRoot, relDir));
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }
  // Read concurrently: every chat list in the app waits on this, and the husks
  // are independent files. Bounded, though — a box accumulates one husk per
  // chat forever, so this list grows without limit and unbounded fan-out here
  // would eventually exhaust file descriptors. `allSettled` per code-style: an
  // unreadable husk is already a per-file skip and must not abandon the rest.
  const settled = await mapInBatchesSettled(
    names.filter((name) => name.endsWith(".chat.card")),
    { size: READ_CONCURRENCY, map: (name) => readChatHusk(boxRoot, `${relDir}/${name}`) },
  );
  const out: ChatHuskEntry[] = [];
  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      console.warn(`chat-husk: skipping a card under ${relDir}:`, outcome.reason);
      continue;
    }
    if (outcome.value !== null) out.push(outcome.value);
  }
  return out;
}

/**
 * Read one husk card into its entry, or null (with a warning) when it isn't a
 * usable husk. The per-file half of `listChatHusks`, split out so a single
 * session can be resolved without reading every husk in the box.
 */
export async function readChatHusk(boxRoot: string, relPath: string): Promise<ChatHuskEntry | null> {
  let content: string;
  try {
    content = await fs.readFile(path.join(boxRoot, relPath), "utf-8");
  } catch (e) {
    console.warn(`chat-husk: skipping unreadable ${relPath}: ${errorMessage(e)}`);
    return null;
  }
  const fm = parseHuskFrontmatter(content);
  if (fm === null) {
    console.warn(`chat-husk: skipping ${relPath}: no frontmatter mapping`);
    return null;
  }
  const session = fm["session"];
  if (typeof session !== "string" || session === "") {
    console.warn(`chat-husk: skipping ${relPath}: no session field`);
    return null;
  }
  const contextDir = fm["context-dir"];
  const title = fm["title"];
  return {
    path: relPath,
    session,
    ...(typeof contextDir === "string" ? { contextDir } : {}),
    ...(typeof title === "string" && title !== "" ? { title } : {}),
  };
}

/**
 * The husk for one session, or null when it has none.
 *
 * The `session` field is authoritative — a husk can be renamed freely, and the
 * card enumerations (`listChatHusks` and everything built on it) key on the
 * field, not the filename. So the filename convention is only a fast path
 * here: when it misses (or names a card whose `session` says otherwise), fall
 * back to reading the husks and matching the field, which is what the pickers
 * would have found.
 */
export async function findChatHuskEntry(boxRoot: string, sessionId: string): Promise<ChatHuskEntry | null> {
  const relPath = await findChatHusk(boxRoot, sessionId);
  if (relPath !== null) {
    const entry = await readChatHusk(boxRoot, relPath);
    if (entry !== null && entry.session === sessionId) return entry;
  }
  const husks = await listChatHusks(boxRoot);
  return husks.find((h) => h.session === sessionId) ?? null;
}

/**
 * Give every resumable session in the history file a husk. Ghost entries
 * (no transcript on disk) are skipped — nothing to point at.
 *
 * This **reconciles on every boot** rather than running once behind a marker
 * file. Husks are the enumeration for both the picker and the history dropdown
 * (`core/chat/session/list.ts`), so a session with history but no husk is
 * invisible in the UI — and there are two ways to land there that a one-shot
 * migration could never repair: the eager `ensureChatHusk` at session-id
 * assignment is best-effort (`session/registry.ts` logs and continues), and the
 * history backfill that discovers pre-husk sessions runs concurrently with this
 * one, so it could still be writing entries when this pass reads them.
 *
 * Cheap to repeat: one directory listing plus one history read, and per-session
 * work only for the sessions actually missing a husk.
 */
export async function reconcileChatHusks(boxRoot: string): Promise<void> {
  const [entries, husks] = await Promise.all([loadHistoryEntries(boxRoot), listChatHusks(boxRoot)]);
  const husked = new Set(husks.map((h) => h.session));

  for (const entry of entries) {
    if (husked.has(entry.id)) continue;
    let mtime: Date;
    try {
      mtime = entry.engine === "codex"
        ? await readCodexSessionUpdatedAt(boxRoot, entry.id)
        : (await fs.stat(await resolveSessionLogPath(boxRoot, entry.id))).mtime;
    } catch (_e) {
      // Ghost entry — transcript gone; nothing to resume, so no husk.
      continue;
    }
    await ensureChatHusk(boxRoot, {
      sessionId: entry.id,
      ...(entry.contextDir !== undefined ? { contextDir: entry.contextDir } : {}),
      date: mtime,
    });
  }
}

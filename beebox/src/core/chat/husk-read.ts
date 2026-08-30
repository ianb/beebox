/**
 * Reading chat husks — the enumeration and lookup half of `husk.ts`.
 *
 * Split from the writing half so a module that only needs to *ask* about a
 * husk doesn't drag in husk creation. Creating one reads a transcript
 * (`session/load-history.ts`) to title the card, and that loader resolves the
 * session's engine — so `session/engine.ts`, which now consults the husk's own
 * `engine` stamp, would close a value cycle through the writer. It reaches the
 * readers here instead.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { splitCardContent } from "../../cards/index.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";
import { isRecord } from "../card-io.js";
import { mapInBatchesSettled } from "../../lib/map-batched.js";
import { AGENT_ENGINES, type AgentEngine } from "../../shared/agent-models.js";

/** Husk cards read at once — see {@link mapInBatchesSettled}. */
const READ_CONCURRENCY = 64;

export const CHAT_HUSK_DIR = "store/chat/web";
/** Everything chat-shaped: the active husks, plus whatever sits beside them. */
const CHAT_DIR = "store/chat";

export function shortId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

/**
 * The husk path matching the `_<shortid>.chat.card` filename convention, or
 * null. A fast path only — the filename is a naming convention, never the key,
 * so every caller must confirm the card's `session` field and fall back to the
 * field scan when this misses. Private for that reason.
 */
async function findHuskBySuffix(boxRoot: string, sessionId: string): Promise<string | null> {
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

/** Frontmatter mapping from a husk file, or null when the shape is wrong. */
export function parseHuskFrontmatter(content: string): Record<string, unknown> | null {
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
  /**
   * Which engine ran the chat — the durable copy of what the per-checkout
   * history file holds, and the first thing `resolveChatEngine` consults. A
   * husk carried to a machine that never ran the session has no history entry
   * to fall back on, so without this a Codex chat would read as a Claude one.
   * Absent on husks written before Track 2.
   */
  engine?: AgentEngine;
  /** Machine id stamped at creation; absent on husks written before Track 2. */
  origin?: string;
  /**
   * The origin machine's hostname at stamp time — a display label only, and
   * possibly stale (a laptop renames itself with its network location). Lists
   * fall back to the id when it is absent.
   */
  originName?: string;
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
  const chatCards = names.filter((name) => name.endsWith(".chat.card"));
  return readHusks(boxRoot, chatCards.map((name) => `${relDir}/${name}`));
}

/**
 * Every husk anywhere under `store/chat/**` — the whole-tree counterpart to
 * `listChatHusks`, which is deliberately only the active `web/` directory.
 * Used by the duplicate-`session` lint, which has to see a renamed or
 * hand-filed husk wherever it landed, not just the ones the pickers enumerate.
 */
export async function listChatHusksTree(boxRoot: string): Promise<ChatHuskEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(path.join(boxRoot, CHAT_DIR), { recursive: true });
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }
  const chatCards = names.filter((name) => name.endsWith(".chat.card"));
  return readHusks(boxRoot, chatCards.map((name) => `${CHAT_DIR}/${name.split(path.sep).join("/")}`));
}

/**
 * Read a set of husk paths into entries, skipping the unusable ones.
 *
 * Concurrent: every chat list in the app waits on this, and the husks are
 * independent files. Bounded, though — a box accumulates one husk per chat
 * forever, so this list grows without limit and unbounded fan-out here would
 * eventually exhaust file descriptors. `allSettled` per code-style: an
 * unreadable husk is already a per-file skip and must not abandon the rest.
 */
async function readHusks(boxRoot: string, relPaths: string[]): Promise<ChatHuskEntry[]> {
  const settled = await mapInBatchesSettled(
    relPaths,
    { size: READ_CONCURRENCY, map: (relPath) => readChatHusk(boxRoot, relPath) },
  );
  const out: ChatHuskEntry[] = [];
  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      console.warn("chat-husk: skipping a chat card:", outcome.reason);
      continue;
    }
    if (outcome.value !== null) out.push(outcome.value);
  }
  return out;
}

/**
 * The card's `engine`, validated against the same enum the schema declares —
 * a hand-edited or hand-copied value that isn't an engine we run reads as
 * absent, so resolution falls through to the history entry instead of
 * carrying a nonsense string into engine dispatch. Never silent.
 */
function parseHuskEngine(raw: unknown, relPath: string): AgentEngine | undefined {
  if (raw === undefined) return undefined;
  const found = AGENT_ENGINES.find((engine) => engine === raw);
  if (found === undefined) {
    console.warn(`chat-husk: ${relPath} has an unknown engine ${JSON.stringify(raw)}; ignoring it`);
    return undefined;
  }
  return found;
}

/**
 * Read one husk card into its entry, or null (with a warning) when it isn't a
 * usable husk. The per-file half of `listChatHusks`, split out so a single
 * session can be resolved without reading every husk in the box.
 */
async function readChatHusk(boxRoot: string, relPath: string): Promise<ChatHuskEntry | null> {
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
  const engine = parseHuskEngine(fm["engine"], relPath);
  const origin = fm["origin"];
  const originName = fm["origin-name"];
  return {
    path: relPath,
    session,
    ...(typeof contextDir === "string" ? { contextDir } : {}),
    ...(typeof title === "string" && title !== "" ? { title } : {}),
    ...(engine !== undefined ? { engine } : {}),
    ...(typeof origin === "string" && origin !== "" ? { origin } : {}),
    ...(typeof originName === "string" && originName !== "" ? { originName } : {}),
  };
}

/**
 * Husk paths grouped by their `session` field — the shape both duplicate
 * checks want (card-lint's cross-file rule at commit time, reconcile's
 * warning at boot). One definition so the two can't disagree about what
 * "the same session" means.
 */
export function groupHusksBySession(husks: ChatHuskEntry[]): Map<string, string[]> {
  const bySession = new Map<string, string[]>();
  for (const husk of husks) {
    const paths = bySession.get(husk.session);
    if (paths === undefined) bySession.set(husk.session, [husk.path]);
    else paths.push(husk.path);
  }
  return bySession;
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
  const relPath = await findHuskBySuffix(boxRoot, sessionId);
  if (relPath !== null) {
    const entry = await readChatHusk(boxRoot, relPath);
    if (entry !== null && entry.session === sessionId) return entry;
  }
  const husks = await listChatHusks(boxRoot);
  return husks.find((h) => h.session === sessionId) ?? null;
}

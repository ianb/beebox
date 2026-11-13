/**
 * The per-session activity cursor and window.
 *
 * `.beebox/activity-cursor/<session>.json` holds `{ hinted, previous,
 * pendingKeys, sentAt }`. At a person's send `previous` becomes the old
 * `hinted` and `hinted` becomes the log's highest `seq`. A session's window is
 * its entries with `seq` above `previous`: those up to `hinted` were counted
 * into this turn's hint, and an entry that lands later is above `hinted`, so
 * it falls in the next window as well. An entry belongs to a session when its
 * `chat` is the session id or its `pendingChat` is one of `pendingKeys`.
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { errnoCode } from "../../shared/error-guards.js";
import type { ActivityLine } from "./entry.js";
import { lastActivitySeq, readActivity, withActivityLock } from "./log.js";

const cursorSchema = z.object({
  hinted: z.number().int().nonnegative(),
  previous: z.number().int().nonnegative(),
  pendingKeys: z.array(z.string()),
  sentAt: z.string().optional(),
});

export type ActivityCursor = z.infer<typeof cursorSchema>;

const SESSION_ID = /^[\w-]{1,128}$/;

/** Thrown when a cursor is asked for under a name that is not a plain session id. */
export class ActivitySessionIdError extends Error {
  constructor() {
    super("The activity cursor needs a plain chat session id");
    this.name = "ActivitySessionIdError";
  }
}

function cursorPath(boxRoot: string, sessionId: string): string {
  if (!SESSION_ID.test(sessionId)) throw new ActivitySessionIdError();
  return path.join(boxRoot, ".beebox", "activity-cursor", `${sessionId}.json`);
}

/** The session's cursor, or null when no send has advanced one yet. */
export async function readCursor(boxRoot: string, sessionId: string): Promise<ActivityCursor | null> {
  let raw: string;
  try {
    raw = await fsp.readFile(cursorPath(boxRoot, sessionId), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    console.warn(`[activity-cursor] ignoring an invalid cursor for ${sessionId}: ${parsed.error.message}`);
  } catch (e) {
    console.warn(`[activity-cursor] ignoring an unparseable cursor for ${sessionId}:`, e);
  }
  return null;
}

async function writeCursor(boxRoot: string, to: { sessionId: string; cursor: ActivityCursor }): Promise<void> {
  await writeFileAtomic(cursorPath(boxRoot, to.sessionId), { content: `${JSON.stringify(to.cursor)}\n` });
}

function inSession(line: ActivityLine, who: { sessionId: string | null; keys: readonly string[] }): boolean {
  const { sessionId, keys } = who;
  if (sessionId !== null && line.chat === sessionId) return true;
  return line.pendingChat !== undefined && keys.includes(line.pendingChat);
}

/** A session's entries with `seq` above `previous`, oldest first, optionally only one card's. */
export async function activityWindow(
  boxRoot: string,
  opts: { sessionId: string; card?: string },
): Promise<{ cursor: ActivityCursor | null; entries: ActivityLine[] }> {
  const cursor = await readCursor(boxRoot, opts.sessionId);
  const keys = cursor?.pendingKeys ?? [];
  const entries = (await readActivity(boxRoot)).filter((line) =>
    line.seq > (cursor?.previous ?? 0) && inSession(line, { sessionId: opts.sessionId, keys }) && (opts.card === undefined || line.card === opts.card));
  return { cursor, entries };
}

export interface ActivityHint {
  entries: number;
  cards: number;
}

/** First turns of new chats: what `advanceForSend` counted, until the session id arrives and `bindPendingChat` stores it. */
const unboundTurns = new Map<string, { hinted: number; sentAt: string }>();

function unboundKey(boxRoot: string, pendingChat: string): string {
  return `${boxRoot}\0${pendingChat}`;
}

/**
 * Advance the cursor for one person-turn and count what it covers. Called
 * once per turn (queued sends are combined first). With no `sessionId`, the
 * first turn of a new chat, nothing is stored on disk: the counts come from
 * `pendingChat` alone and `bindPendingChat` stores the cursor when the id
 * arrives.
 */
export async function advanceForSend(
  boxRoot: string,
  opts: { sessionId: string | null; pendingChat?: string | undefined },
): Promise<ActivityHint> {
  return withActivityLock(boxRoot, async () => {
    const hinted = await lastActivitySeq(boxRoot);
    const sentAt = getBoxTimeISO(boxRoot);
    const old = opts.sessionId === null ? null : await readCursor(boxRoot, opts.sessionId);
    const keys = [...new Set([...(old?.pendingKeys ?? []), ...(opts.pendingChat === undefined ? [] : [opts.pendingChat])])];
    const previous = old?.hinted ?? 0;
    const lines = (await readActivity(boxRoot)).filter((line) =>
      line.seq > previous && line.seq <= hinted && inSession(line, { sessionId: opts.sessionId, keys }));
    if (opts.sessionId !== null) {
      await writeCursor(boxRoot, { sessionId: opts.sessionId, cursor: { hinted, previous, pendingKeys: keys, sentAt } });
    } else if (opts.pendingChat !== undefined) {
      unboundTurns.set(unboundKey(boxRoot, opts.pendingChat), { hinted, sentAt });
    }
    return { entries: lines.length, cards: new Set(lines.map((l) => l.card)).size };
  });
}

/** Bind a new chat's page key to the session id once it is assigned, storing the cursor its first turn computed. */
export async function bindPendingChat(
  boxRoot: string,
  opts: { sessionId: string; pendingChat: string },
): Promise<void> {
  await withActivityLock(boxRoot, async () => {
    const key = unboundKey(boxRoot, opts.pendingChat);
    const turn = unboundTurns.get(key);
    unboundTurns.delete(key);
    const old = await readCursor(boxRoot, opts.sessionId);
    if (old !== null) {
      await writeCursor(boxRoot, { sessionId: opts.sessionId, cursor: { ...old, pendingKeys: [...new Set([...old.pendingKeys, opts.pendingChat])] } });
      return;
    }
    const sentAt = turn?.sentAt ?? getBoxTimeISO(boxRoot);
    await writeCursor(boxRoot, { sessionId: opts.sessionId, cursor: { hinted: turn?.hinted ?? 0, previous: 0, pendingKeys: [opts.pendingChat], sentAt } });
  });
}

/** The `<activity entries="N" cards="M"/>` snapshot child, or "" for an empty window. */
export function renderActivityHint(hint: ActivityHint): string {
  return hint.entries === 0 ? "" : `<activity entries="${String(hint.entries)}" cards="${String(hint.cards)}"/>`;
}

/**
 * Where quick chat records live on disk.
 *
 * A record in `needs-choice` or `sending` lives in
 * `.beebox/quick-chat/open/<id>.json`, so listing what still needs the person
 * costs nothing as history grows. A `sent` or `discarded` record lives in
 * `.beebox/quick-chat/<id>.json`, where records written before states existed
 * also live. The lock does not move with the record: every procedure locks
 * `.beebox/quick-chat/<id>.json.lock`, whatever the state.
 */

import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import * as path from "node:path";
import { writeFileAtomic } from "../../../lib/atomic-write.js";
import { withFileLock } from "../../../lib/file-lock.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { invariant } from "../../../shared/invariant.js";
import { parseQuickChatRecord, type QuickChatRecord } from "./quick-chat-record.js";

const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const RECENTLY_SENT_MS = 24 * 60 * 60 * 1000;

function quickChatDir(boxRoot: string): string {
  return path.join(boxRoot, ".beebox", "quick-chat");
}

/** The closed location; also where `quickChat.prepare` keeps its records. */
export function closedRecordPath(boxRoot: string, id: string): string {
  invariant(UUID.test(id), "Quick chat record ids are UUIDs");
  return path.join(quickChatDir(boxRoot), `${id}.json`);
}

function openRecordPath(boxRoot: string, id: string): string {
  invariant(UUID.test(id), "Quick chat record ids are UUIDs");
  return path.join(quickChatDir(boxRoot), "open", `${id}.json`);
}

function isOpen(record: QuickChatRecord): boolean {
  return record.state === "needs-choice" || record.state === "sending";
}

async function readJson(file: string): Promise<unknown> {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (errnoCode(error) === "ENOENT") return undefined; throw error; }
}

/**
 * Read one record. A closed record that is final wins: a crash between
 * writing it and removing the open copy must not revive the open one. An
 * older record in the closed location without a final state yields to an
 * open copy written since.
 */
export async function readQuickChatRecord(boxRoot: string, id: string): Promise<QuickChatRecord | null> {
  const closedRaw = await readJson(closedRecordPath(boxRoot, id));
  const closed = closedRaw === undefined ? null : parseQuickChatRecord(closedRaw);
  if (closed !== null && !isOpen(closed)) return closed;
  const openRaw = await readJson(openRecordPath(boxRoot, id));
  return openRaw === undefined ? closed : parseQuickChatRecord(openRaw);
}

/** Write a record to the location its state names, then drop the open copy once it is final. */
export async function saveQuickChatRecord(boxRoot: string, record: QuickChatRecord): Promise<void> {
  const content = JSON.stringify(record);
  if (isOpen(record)) {
    const file = openRecordPath(boxRoot, record.id);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFileAtomic(file, { content, mode: 0o600 });
    return;
  }
  await writeFileAtomic(closedRecordPath(boxRoot, record.id), { content, mode: 0o600 });
  await rm(openRecordPath(boxRoot, record.id), { force: true });
}

/** Run `fn` under the record's one lock, wherever the record lives. */
export async function withQuickChatLock<T>({ boxRoot, id }: { boxRoot: string; id: string }, fn: () => Promise<T>): Promise<T> {
  await mkdir(quickChatDir(boxRoot), { recursive: true });
  return withFileLock({ lockPath: `${closedRecordPath(boxRoot, id)}.lock`, metadata: { purpose: "quick-chat" }, waitMs: 35000 }, fn);
}

async function listJsonIds(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir);
    return names.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -".json".length)).filter((id) => UUID.test(id));
  } catch (error) { if (errnoCode(error) === "ENOENT") return []; throw error; }
}

/** Every record still waiting for the person or for delivery, oldest first. */
export async function listOpenQuickChatRecords(boxRoot: string): Promise<QuickChatRecord[]> {
  const ids = await listJsonIds(path.join(quickChatDir(boxRoot), "open"));
  const records = await Promise.all(ids.map((id) => readQuickChatRecord(boxRoot, id)));
  return records.filter((record): record is QuickChatRecord => record !== null && isOpen(record))
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * Records sent in the last day, newest first. A record's file is written when
 * it is sent, so the scan reads files newest first and stops at the first one
 * older than the window.
 */
export async function listRecentlySentQuickChatRecords(boxRoot: string, { now, limit }: { now: number; limit: number }): Promise<QuickChatRecord[]> {
  const cutoff = now - RECENTLY_SENT_MS;
  const ids = await listJsonIds(quickChatDir(boxRoot));
  const dated = await Promise.all(ids.map(async (id) => ({ id, mtime: (await stat(closedRecordPath(boxRoot, id))).mtimeMs })));
  const sent: QuickChatRecord[] = [];
  for (const { id } of dated.filter((entry) => entry.mtime >= cutoff).toSorted((a, b) => b.mtime - a.mtime)) {
    const record = await readQuickChatRecord(boxRoot, id);
    if (record?.state !== "sent" || record.sentAt === undefined || Date.parse(record.sentAt) < cutoff) continue;
    sent.push(record);
    if (sent.length === limit) break;
  }
  return sent;
}

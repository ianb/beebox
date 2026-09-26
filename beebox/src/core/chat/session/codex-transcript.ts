/** Adapt supported Codex app-server thread history into the chat history model. */

import { z } from "zod";
import { ensureCodexPluginInstalled } from "../../agent/ensure-codex-plugin.js";
import { CodexHistoryServer } from "../../../services/codex-history-server.js";
import { CodexHistoryRpcError } from "../../../services/codex-history-server.js";
import { normalizeCodexToolItem } from "../../../services/codex-tool-activity.js";
import type { SessionEntry, SessionLogSlice } from "../../../cli/lib/session.js";
import { userIdentity } from "../../../cli/lib/session-entry.js";
import * as path from "node:path";
import * as fs from "node:fs";
import { errnoCode } from "../../../lib/error-guards.js";
import { mapV2Path } from "../../migrations/one-root-mapping.js";

const threadReadSchema = z.object({
  thread: z.looseObject({
    cwd: z.string(),
    updatedAt: z.number(),
    turns: z.array(z.looseObject({
      id: z.string(),
      startedAt: z.number().nullable(),
      items: z.array(z.looseObject({
        id: z.string(),
        type: z.string(),
        text: z.string().optional(),
        content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })).optional(),
      })),
    })),
  }),
});

const threadListSchema = z.object({
  data: z.array(z.looseObject({
    id: z.string(),
    preview: z.string(),
    updatedAt: z.number(),
  })),
  nextCursor: z.string().nullable(),
});

export interface CodexThreadMetadata {
  id: string;
  preview: string;
  updatedAt: Date;
}

/**
 * Include SDK `exec` sessions and the interactive sources used by older Bee Box chats.
 *
 * `repair` lets the app-server backfill its thread index by scanning rollout
 * JSONL files. That scan reads every Codex session on the host, not only this
 * box's (seconds on a dev machine with gigabytes of sessions), so listings read
 * the index alone and repair only for threads the index is missing.
 */
export function codexHistoryListParams(options: {
  cwds: string[];
  cursor: string | null;
  repair: boolean;
}): Record<string, unknown> {
  const { cwds, cursor, repair } = options;
  return {
    cursor,
    limit: 100,
    sortKey: "updated_at",
    sortDirection: "desc",
    cwd: cwds,
    sourceKinds: ["cli", "vscode", "exec", "appServer"],
    useStateDbOnly: !repair,
  };
}

interface SharedServer {
  server: CodexHistoryServer;
  ready: Promise<void>;
  chain: Promise<void>;
  idleTimer: NodeJS.Timeout | null;
}

const sharedServers = new Map<string, SharedServer>();
const IDLE_CLOSE_MS = 30_000;

function sharedServer(boxRoot: string): SharedServer {
  const existing = sharedServers.get(boxRoot);
  if (existing !== undefined) return existing;
  const server = new CodexHistoryServer(boxRoot);
  const entry: SharedServer = {
    server,
    ready: server.initialize(),
    chain: Promise.resolve(),
    idleTimer: null,
  };
  server.onExit(() => sharedServers.delete(boxRoot));
  sharedServers.set(boxRoot, entry);
  return entry;
}

async function withSharedServer<T>(boxRoot: string, operation: (server: CodexHistoryServer) => Promise<T>): Promise<T> {
  await ensureCodexPluginInstalled();
  const entry = sharedServer(boxRoot);
  if (entry.idleTimer !== null) clearTimeout(entry.idleTimer);
  const result = entry.chain.then(async () => {
    try {
      await entry.ready;
      return await operation(entry.server);
    } catch (error) {
      sharedServers.delete(boxRoot);
      entry.server.close();
      throw error;
    }
  });
  const settled = result.then(() => {}, () => {});
  entry.chain = settled;
  await result.finally(() => {
    if (entry.chain !== settled) return;
    entry.idleTimer = setTimeout(() => {
      if (sharedServers.get(boxRoot) !== entry) return;
      sharedServers.delete(boxRoot);
      entry.server.close();
    }, IDLE_CLOSE_MS);
    entry.idleTimer.unref();
  });
  return result;
}

async function readThread(boxRoot: string, sessionId: string): Promise<unknown> {
  const raw = await withSharedServer(boxRoot, (server) => server.readThread(sessionId));
  assertCodexThreadCwd(boxRoot, threadReadSchema.parse(raw).thread.cwd);
  return raw;
}

class CodexSessionOutsideBoxError extends Error {
  constructor() {
    super("Codex session belongs to a working directory outside this box");
    this.name = "CodexSessionOutsideBoxError";
  }
}

/**
 * Finding 4 (round 5 hardening): a Codex thread recorded BEFORE the one-root
 * migration carries a `cwd` under the retired v2 operational root
 * (`<boxRoot>/content[/…]`) — Codex's own session storage is external to the
 * box's own repo (a subprocess-managed history the migration never touches),
 * so that `cwd` is frozen exactly as the session recorded it. Once `content/`
 * is gone, `fs.realpathSync(threadCwd)` throws ENOENT and every such thread
 * becomes permanently unreadable.
 *
 * A narrow READ-time fallback: when `threadCwd` doesn't exist AND sits under
 * `<boxRoot>/content`, translate it through the same v2 → v3 mapping table
 * the migration itself used (`one-root-mapping.ts`'s `mapV2Path` — the
 * content root itself maps to the box root; a nested `content/<sub>` maps to
 * whatever area `<sub>` landed in) and retry the ownership check against the
 * translated path. A `threadCwd` this can't translate (outside `content/`
 * entirely, or naming something `mapV2Path` doesn't recognize) falls through
 * to the original ENOENT, unchanged.
 */
function translateRetiredV2ContentCwd(boxRoot: string, threadCwd: string): string | null {
  // Compared against the RAW `boxRoot` (as passed in, not realpath'd) — it's
  // the same value a v2-era session recorded its cwd relative to, so the
  // prefix match holds even when `boxRoot` itself sits behind a symlink
  // (e.g. macOS's `/var` -> `/private/var`); the result is realpath'd by the
  // caller once it's built.
  const v2ContentRoot = path.join(boxRoot, "content");
  if (threadCwd !== v2ContentRoot && !threadCwd.startsWith(v2ContentRoot + path.sep)) return null;
  if (threadCwd === v2ContentRoot) return boxRoot;
  const contentRelPath = path.relative(v2ContentRoot, threadCwd).split(path.sep).join("/");
  const mapped = mapV2Path(contentRelPath);
  return mapped.kind === "move" ? path.join(boxRoot, mapped.newPath) : null;
}

/** Realpath `threadCwd` for the ownership check below, falling back to the
 * v2→v3 translation above when the raw path is a retired content-root path
 * that no longer exists. Any other `realpathSync` failure (a session whose
 * cwd never existed, or was removed for an unrelated reason) propagates
 * unchanged — this fallback covers exactly the one-root migration's own
 * retired layout, nothing else. */
function realpathThreadCwd(boxRoot: string, threadCwd: string): string {
  try {
    return fs.realpathSync(threadCwd);
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
    const translated = translateRetiredV2ContentCwd(boxRoot, threadCwd);
    if (translated === null) throw e;
    return fs.realpathSync(translated);
  }
}

/** `thread/read` accepts any known ID, so enforce the box boundary ourselves. */
export function assertCodexThreadCwd(boxRoot: string, threadCwd: string): void {
  const realBoxRoot = fs.realpathSync(boxRoot);
  const relative = path.relative(realBoxRoot, realpathThreadCwd(boxRoot, threadCwd));
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new CodexSessionOutsideBoxError();
}

function timestamp(seconds: number | null): string {
  return seconds === null ? "" : new Date(seconds * 1000).toISOString();
}

function entriesFromThread(raw: unknown): SessionEntry[] {
  const thread = threadReadSchema.parse(raw).thread;
  const entries: SessionEntry[] = [];
  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (item.type === "userMessage") {
        const text = item.content?.filter((part) => part.type === "text")
          .map((part) => part.text ?? "").join("\n") ?? "";
        if (text !== "") {
          const content = [{ type: "text" as const, text }];
          const user = userIdentity(content, "user");
          const userEmail = userIdentity(content, "user-email");
          entries.push({
            uuid: item.id,
            type: "user",
            timestamp: timestamp(turn.startedAt),
            content,
            ...(user ? { user } : {}),
            ...(userEmail ? { userEmail } : {}),
          });
        }
      } else if (item.type === "agentMessage" && item.text !== undefined) {
        entries.push({
          uuid: item.id,
          type: "assistant",
          timestamp: timestamp(turn.startedAt),
          content: [{ type: "text", text: item.text }],
        });
      } else {
        const tool = normalizeCodexToolItem(item);
        if (tool !== null) {
          entries.push({
            uuid: item.id,
            type: "assistant",
            timestamp: timestamp(turn.startedAt),
            content: [{
              type: "tool_use",
              toolId: tool.id,
              toolName: tool.name,
              input: tool.input,
              inputSummary: tool.name,
            }],
          });
        } else if (item.type === "contextCompaction") {
          entries.push({ uuid: item.id, type: "compaction", timestamp: timestamp(turn.startedAt), content: [] });
        }
      }
    }
  }
  return entries;
}

/** Pure, fixture-testable boundary from app-server history to UI entries. */
export function adaptCodexThreadHistory(
  raw: unknown,
  slice: SessionLogSlice,
): { entries: SessionEntry[]; total: number } {
  const all = entriesFromThread(raw);
  return { entries: sliceEntries(all, slice), total: all.length };
}

function sliceEntries(entries: SessionEntry[], slice: SessionLogSlice): SessionEntry[] {
  if (slice.mode === "page") return entries.slice(slice.offset, slice.offset + slice.limit);
  let start = Math.max(0, entries.length - slice.tail);
  const minimum = slice.minRealUserMessages ?? 0;
  if (minimum > 0) {
    let users = 0;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (entries[index]?.type === "user") users += 1;
      if (users >= minimum) {
        start = Math.min(start, index);
        break;
      }
    }
  }
  return entries.slice(start);
}

export async function readCodexSessionHistory(options: {
  boxRoot: string;
  sessionId: string;
  slice: SessionLogSlice;
}): Promise<{ entries: SessionEntry[]; total: number }> {
  const raw = await readThread(options.boxRoot, options.sessionId);
  return adaptCodexThreadHistory(raw, options.slice);
}

/**
 * `readCodexSessionHistory`, with "Codex has no such thread" as an answer
 * rather than a throw — `null` for a thread that does not exist.
 *
 * The Claude side of the same question has always been tolerant: its reader
 * treats ENOENT on the transcript file as an empty transcript. Codex's reader
 * had no equivalent, so an id Codex did not know propagated an RPC error all
 * the way to a chat error banner instead of an empty chat. A genuine failure
 * (the app-server died, the request timed out, the box has no codex binary)
 * still throws.
 */
export async function readCodexSessionHistoryIfPresent(options: {
  boxRoot: string;
  sessionId: string;
  slice: SessionLogSlice;
}): Promise<{ entries: SessionEntry[]; total: number } | null> {
  try {
    return await readCodexSessionHistory(options);
  } catch (error) {
    if (error instanceof CodexHistoryRpcError && error.isNotFound) return null;
    throw error;
  }
}

/** Last native update time, used where Claude uses transcript mtime. */
export async function readCodexSessionUpdatedAt(boxRoot: string, sessionId: string): Promise<Date> {
  const raw = await readThread(boxRoot, sessionId);
  return new Date(threadReadSchema.parse(raw).thread.updatedAt * 1000);
}

/**
 * Thread ids a repair scan has already looked for, per box. A thread the scan
 * could not find stays missing (its husk lists as dead), so looking again on
 * every listing would put the full scan back on the hot path.
 */
const repairAttempted = new Map<string, Set<string>>();

/**
 * List native metadata from Codex's thread index for chat-picker rendering.
 *
 * `expectedIds` are the threads the caller has husks for. When the index lacks
 * one that no earlier repair already looked for, the listing runs once more
 * with the rollout repair scan, and the two answers are merged.
 */
export async function listCodexThreadMetadata(
  boxRoot: string,
  options: { cwds: string[]; expectedIds: string[] },
): Promise<Map<string, CodexThreadMetadata>> {
  const { cwds, expectedIds } = options;
  const indexed = await listThreadPages(boxRoot, { cwds, repair: false });
  const attempted = repairAttempted.get(boxRoot) ?? new Set<string>();
  const unrepaired = expectedIds.filter((id) => !indexed.has(id) && !attempted.has(id));
  if (unrepaired.length === 0) return indexed;
  const repaired = await listThreadPages(boxRoot, { cwds, repair: true });
  for (const id of unrepaired) attempted.add(id);
  repairAttempted.set(boxRoot, attempted);
  // Merged over the index: the scan can miss a thread the index already has.
  return new Map([...indexed, ...repaired]);
}

async function listThreadPages(
  boxRoot: string,
  options: { cwds: string[]; repair: boolean },
): Promise<Map<string, CodexThreadMetadata>> {
  return withSharedServer(boxRoot, async (server) => {
    const threads = new Map<string, CodexThreadMetadata>();
    let cursor: string | null = null;
    do {
      const raw = await server.listThreads(codexHistoryListParams({ ...options, cursor }));
      const page = threadListSchema.parse(raw);
      for (const thread of page.data) {
        threads.set(thread.id, {
          id: thread.id,
          preview: thread.preview,
          updatedAt: new Date(thread.updatedAt * 1000),
        });
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    return threads;
  });
}

export async function codexSessionExists(boxRoot: string, sessionId: string): Promise<boolean> {
  try {
    await readThread(boxRoot, sessionId);
    return true;
  } catch (error) {
    if (error instanceof CodexHistoryRpcError && error.isNotFound) return false;
    throw error;
  }
}

export async function deleteCodexSession(boxRoot: string, sessionId: string): Promise<void> {
  await withSharedServer(boxRoot, async (server) => {
    await server.deleteThread(sessionId);
  });
}

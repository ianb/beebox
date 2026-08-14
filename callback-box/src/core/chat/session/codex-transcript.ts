/** Adapt supported Codex app-server thread history into the chat history model. */

import { z } from "zod";
import { ensureCodexPluginInstalled } from "../../agent/ensure-codex-plugin.js";
import { CodexAppServer } from "../../../services/codex-app-server.js";
import { CodexRpcError } from "../../../services/codex-app-server.js";
import type { SessionEntry, SessionLogSlice } from "../../../cli/lib/session.js";

const threadReadSchema = z.object({
  thread: z.looseObject({
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

interface SharedServer {
  server: CodexAppServer;
  ready: Promise<void>;
  chain: Promise<void>;
  idleTimer: NodeJS.Timeout | null;
}

const sharedServers = new Map<string, SharedServer>();
const IDLE_CLOSE_MS = 30_000;

function sharedServer(boxRoot: string): SharedServer {
  const existing = sharedServers.get(boxRoot);
  if (existing !== undefined) return existing;
  const server = new CodexAppServer({ cwd: boxRoot });
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

async function withSharedServer<T>(boxRoot: string, operation: (server: CodexAppServer) => Promise<T>): Promise<T> {
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
  return withSharedServer(boxRoot, (server) => server.request({
    method: "thread/read",
    params: { threadId: sessionId, includeTurns: true },
  }));
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
          entries.push({ uuid: item.id, type: "user", timestamp: timestamp(turn.startedAt), content: [{ type: "text", text }] });
        }
      } else if (item.type === "agentMessage" && item.text !== undefined) {
        entries.push({
          uuid: item.id,
          type: "assistant",
          timestamp: timestamp(turn.startedAt),
          content: [{ type: "text", text: item.text }],
        });
      } else if (item.type === "contextCompaction") {
        entries.push({ uuid: item.id, type: "compaction", timestamp: timestamp(turn.startedAt), content: [] });
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

/** Last native update time, used where Claude uses transcript mtime. */
export async function readCodexSessionUpdatedAt(boxRoot: string, sessionId: string): Promise<Date> {
  const raw = await readThread(boxRoot, sessionId);
  return new Date(threadReadSchema.parse(raw).thread.updatedAt * 1000);
}

/** List native metadata in one paginated RPC sequence for chat-picker rendering. */
export async function listCodexThreadMetadata(
  boxRoot: string,
  cwds: string[],
): Promise<Map<string, CodexThreadMetadata>> {
  return withSharedServer(boxRoot, async (server) => {
    const threads = new Map<string, CodexThreadMetadata>();
    let cursor: string | null = null;
    do {
      const raw = await server.request({
        method: "thread/list",
        params: {
          cursor,
          limit: 100,
          sortKey: "updated_at",
          sortDirection: "desc",
          cwd: cwds,
          useStateDbOnly: true,
        },
      });
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
    if (error instanceof CodexRpcError && /not found|not loaded|unknown thread/i.test(error.rpcMessage)) return false;
    throw error;
  }
}

export async function deleteCodexSession(boxRoot: string, sessionId: string): Promise<void> {
  await withSharedServer(boxRoot, async (server) => {
    await server.request({ method: "thread/delete", params: { threadId: sessionId } });
  });
}

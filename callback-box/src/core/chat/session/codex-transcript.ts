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

async function readThread(boxRoot: string, sessionId: string): Promise<unknown> {
  await ensureCodexPluginInstalled();
  const server = new CodexAppServer({ cwd: boxRoot });
  try {
    await server.initialize();
    return await server.request({ method: "thread/read", params: { threadId: sessionId, includeTurns: true } });
  } finally {
    server.close();
  }
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
  await ensureCodexPluginInstalled();
  const server = new CodexAppServer({ cwd: boxRoot });
  try {
    await server.initialize();
    await server.request({ method: "thread/delete", params: { threadId: sessionId } });
  } finally {
    server.close();
  }
}

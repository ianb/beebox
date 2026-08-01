/**
 * Chat session procedures that read only persisted state (no live session
 * registry): conversation history, the web-chat session list, the default
 * session id, and a session's resolved feature map. Spread into the chat
 * router so paths stay `trpc.chat.history` etc.
 *
 * The registry/scheduleManager-dependent chat controls (status, set-model,
 * set-feature, interrupt, restart, schedules) stay raw Fastify routes — they
 * need the live per-box `ChatSessionRegistry`, the same reason `/chat/send` is
 * raw — they now live in `chat-control-procedures.ts` via `chat-runtime`.
 */

import { z } from "zod";
import { publicProcedure } from "../trpc.js";
import {
  getFeaturesForSession,
  getMostActive,
  resolveSessionLogPath,
} from "../../../core/chat/session/history.js";
import { resolveFeatures } from "../../../core/chat/features.js";
import {
  parseSessionLog,
  tailForMinUserMessages,
} from "../../../cli/lib/session.js";
import { loadAllSessions } from "../../../core/chat/session/list.js";
import { landmarkLabelsForDirs } from "../../../core/landmark/summaries.js";

/**
 * How much of a session's log to return. Shared by `chat.history` (which adds
 * a required `session`) and `chat.bootstrap` (which resolves the session
 * itself), so the two can never drift apart on slicing.
 */
export const historySliceSchema = z.object({
  tail: z.number().optional(),
  offset: z.number().optional(),
  limit: z.number().optional(),
  minRealUserMessages: z.number().optional(),
});

export type HistorySlice = z.infer<typeof historySliceSchema>;

export interface SessionHistory {
  sessionId: string;
  entries: Awaited<ReturnType<typeof parseSessionLog>>["entries"];
  total: number;
}

/**
 * Load + slice one session's conversation history. A session with no readable
 * log reads as empty rather than failing — an id that hasn't produced a JSONL
 * yet (a brand-new chat, an SDK turn that errored before writing) is a normal
 * state, not an error.
 */
export async function loadSessionHistory(
  boxRoot: string,
  input: HistorySlice & { session: string },
): Promise<SessionHistory> {
  const { session: sessionId, tail, offset, limit, minRealUserMessages } = input;
  const logPath = await resolveSessionLogPath(boxRoot, sessionId);
  try {
    const result = await parseSessionLog({
      logPath,
      ...(offset != null ? { offset } : {}),
      ...(limit != null ? { limit } : {}),
    });
    const { entries, total } = result;
    const userTail =
      minRealUserMessages && minRealUserMessages > 0
        ? tailForMinUserMessages(entries, minRealUserMessages)
        : 0;
    const effective = tail && tail > 0 ? Math.max(tail, userTail) : userTail > 0 ? userTail : undefined;
    if (effective !== undefined && effective < entries.length) {
      return { sessionId, entries: entries.slice(entries.length - effective), total };
    }
    return { sessionId, entries, total };
  } catch (_e) {
    return { sessionId, entries: [], total: 0 };
  }
}

export const chatSessionProcedures = {
  // Load + slice a session's conversation history.
  history: publicProcedure
    .input(historySliceSchema.extend({ session: z.string() }))
    .query(({ input, ctx }) => loadSessionHistory(ctx.boxRoot, input)),

  // List web-chat sessions, most-recent first, for the history dropdown.
  //
  // Enumerated from husk cards through the same `loadAllSessions` the landmark
  // picker uses — the cards are the source of truth for which chats exist, so
  // deleting a husk removes the chat from both lists rather than only the
  // picker. Labels resolve through the shared order (husk title >
  // first-message snippet > id prefix).
  //
  // Each row carries its landmark binding so the dropdown can put the current
  // landmark's chats first: `contextDir` ("" for root/legacy-unbound) plus the
  // landmark's display label, resolved here so the client stays dumb.
  sessions: publicProcedure.query(async ({ ctx }) => {
    const [rows, mostActive] = await Promise.all([
      loadAllSessions(ctx.boxRoot),
      getMostActive(ctx.boxRoot),
    ]);
    // Only the dirs these sessions actually bind to — a handful — rather than
    // globbing the whole box for landmark cards on every dropdown open.
    const labelByDir = await landmarkLabelsForDirs(
      ctx.boxRoot,
      rows.map((row) => row.contextDir ?? ""),
    );

    const sessions = rows.map((row) => {
      const contextDir = row.contextDir ?? "";
      // A session can outlive its landmark card (or predate one). Fall back to
      // the directory itself so the row still says where the chat lives.
      const landmarkLabel = labelByDir.get(contextDir) ?? (contextDir === "" ? "Root" : contextDir);
      return {
        sessionId: row.sessionId,
        source: "chat",
        label: row.label,
        lastUsedAt: row.mtime.toISOString(),
        isActive: row.sessionId === mostActive,
        contextDir,
        landmarkLabel,
      };
    });
    return { sessions };
  }),

  // Resolve the "most-active" session id (for bare /chat).
  defaultSession: publicProcedure.query(async ({ ctx }) => {
    const sessionId = await getMostActive(ctx.boxRoot);
    return { sessionId };
  }),

  // Read a session's resolved feature map (defaults filled in), from disk.
  features: publicProcedure.input(z.object({ session: z.string() })).query(async ({ input, ctx }) => {
    const stored = await getFeaturesForSession(ctx.boxRoot, input.session).catch(() => null);
    return { features: resolveFeatures(stored) };
  }),
};

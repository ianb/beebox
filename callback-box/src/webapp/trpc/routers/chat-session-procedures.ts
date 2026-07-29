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

import * as fs from "node:fs/promises";
import { z } from "zod";
import { publicProcedure } from "../trpc.js";
import {
  getFeaturesForSession,
  getMostActive,
  loadHistory,
  resolveSessionLogPath,
} from "../../../core/chat/session/history.js";
import { resolveFeatures } from "../../../core/chat/features.js";
import {
  getSessionMetadata,
  parseSessionLog,
  tailForMinUserMessages,
} from "../../../cli/lib/session.js";
import { errnoCode } from "../../../lib/error-guards.js";
import { listChatHusks } from "../../../core/chat/husk.js";
import { resolveSessionLabel } from "../../../core/chat/session-label.js";

export const chatSessionProcedures = {
  // Load + slice a session's conversation history.
  history: publicProcedure
    .input(
      z.object({
        session: z.string(),
        tail: z.number().optional(),
        offset: z.number().optional(),
        limit: z.number().optional(),
        minRealUserMessages: z.number().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { session: sessionId, tail, offset, limit, minRealUserMessages } = input;
      const logPath = await resolveSessionLogPath(ctx.boxRoot, sessionId);
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
    }),

  // List web-chat sessions, most-recent first. Labels resolve through the
  // shared order (husk title > first-message snippet > id prefix), so a title
  // written by hand or by the nightly chat review shows up here — this query
  // used to skip husks entirely and was the reason generated titles were
  // invisible in the history dropdown.
  sessions: publicProcedure.query(async ({ ctx }) => {
    const ids = await loadHistory(ctx.boxRoot);
    const mostActive = await getMostActive(ctx.boxRoot);
    const titlesBySession = new Map(
      (await listChatHusks(ctx.boxRoot)).map((husk) => [husk.session, husk.title]),
    );

    const sessions = await Promise.all(
      ids.map(async (sessionId) => {
        const logPath = await resolveSessionLogPath(ctx.boxRoot, sessionId);
        let lastUsedAt = new Date(0).toISOString();
        try {
          const stat = await fs.stat(logPath);
          lastUsedAt = stat.mtime.toISOString();
          const meta = await getSessionMetadata({ sessionId, logPath });
          if (meta.endTime) lastUsedAt = meta.endTime.toISOString();
        } catch (e) {
          if (errnoCode(e) !== "ENOENT") {
            console.warn(`[chat] session ${sessionId} log unreadable:`, e);
          }
          // JSONL missing or unreadable — resolveSessionLabel falls back too.
        }
        const label = await resolveSessionLabel({
          sessionId,
          logPath,
          title: titlesBySession.get(sessionId),
        });
        return { sessionId, source: "chat", label, lastUsedAt, isActive: sessionId === mostActive };
      }),
    );

    sessions.sort((a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime());
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

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
} from "../../../core/chat/session/history.js";
import { resolveFeatures } from "../../../core/chat/features.js";
import { MAX_SESSION_ENTRIES, type SessionEntry } from "../../../cli/lib/session.js";
import { loadSessionHistory } from "../../../core/chat/session/load-history.js";
import { titleForSession, loadAllSessions } from "../../../core/chat/session/list.js";
import { landmarkLabelsForDirs } from "../../../core/landmark/summaries.js";

/**
 * How much of a session's log to return. Shared by `chat.history` (which adds
 * a required `session`) and `chat.bootstrap` (which resolves the session
 * itself), so the two can never drift apart on slicing.
 *
 * A discriminated union, not a bag of optionals: `tail` and `offset`/`limit`
 * are different requests with different semantics, and every field is an
 * integer with a hard maximum, so no input can ask the parser to retain an
 * unbounded slice of a transcript. Both arms are `.strict()`, so a mixed
 * request (`mode: "tail"` carrying `offset`/`limit`) is rejected rather than
 * silently stripped down to whichever shape it named.
 */
export const historySliceSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("tail"),
    tail: z.number().int().min(1).max(MAX_SESSION_ENTRIES),
    minRealUserMessages: z.number().int().min(0).max(100).optional(),
  }).strict(),
  z.object({
    mode: z.literal("page"),
    offset: z.number().int().min(0),
    limit: z.number().int().min(1).max(MAX_SESSION_ENTRIES),
  }).strict(),
]);

export interface SessionHistory {
  sessionId: string;
  entries: SessionEntry[];
  total: number;
}

/**
 * Load one session's bounded history window, with the session id narrowed back
 * to a string — the shared loader answers for a nullable id, but these
 * procedures only ever call it with a concrete one.
 */
export async function loadHistoryForSession(
  boxRoot: string,
  input: { session: string; slice: z.infer<typeof historySliceSchema> },
): Promise<SessionHistory> {
  const { entries, total } = await loadSessionHistory(boxRoot, {
    sessionId: input.session,
    slice: input.slice,
  });
  return { sessionId: input.session, entries, total };
}

export const chatSessionProcedures = {
  // Load + slice a session's conversation history.
  history: publicProcedure
    .input(z.object({ session: z.string(), slice: historySliceSchema }))
    .query(({ input, ctx }) => loadHistoryForSession(ctx.boxRoot, input)),

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

  // One session's display label, resolved exactly as `chat.bootstrap` and the
  // pickers resolve it (husk title > first-message snippet > id prefix).
  //
  // Bootstrap already carries the label for the session it answered for; this
  // is for the chat page's other case — a chat that started as `session=new`
  // and was assigned an id mid-turn, which no bootstrap ever ran for. Reading
  // only the label keeps that fetch off the transcript the running machine owns.
  label: publicProcedure
    .input(z.object({ session: z.string().min(1) }))
    .query(async ({ input, ctx }): Promise<{ label: string | null }> => {
      const label = await titleForSession(ctx.boxRoot, input.session);
      return { label };
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

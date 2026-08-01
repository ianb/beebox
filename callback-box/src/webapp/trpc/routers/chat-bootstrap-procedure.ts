/**
 * `chat.bootstrap` — everything the chat page needs to render, in one round
 * trip.
 *
 * Opening a bare `/chat` used to cost three serial stages: `chat.defaultSession`
 * to learn the session id, then a client navigation, then `chat.history` +
 * `chat.status` (both of which require a concrete id server-side, so the client
 * couldn't ask for them earlier). On a phone that's three RTTs of blank page.
 * This resolves the session and answers all three at once.
 *
 * It composes the existing implementations — `getMostActive`,
 * `loadSessionHistory`, `readSessionStatus` — rather than restating them, so
 * the atomic path and the individual procedures cannot report different things.
 */

import { z } from "zod";
import { publicProcedure } from "../trpc.js";
import { getMostActive } from "../../../core/chat/session/history.js";
import {
  historySliceSchema,
  loadSessionHistory,
  type SessionHistory,
} from "./chat-session-procedures.js";
import { readSessionStatus, type ChatSessionStatus } from "./chat-control-procedures.js";

export interface ChatBootstrap {
  /** The resolved session, or null when the box has no chat session yet. */
  sessionId: string | null;
  /** Null exactly when `sessionId` is null — there is no history to load. */
  history: SessionHistory | null;
  status: ChatSessionStatus;
}

export const chatBootstrapProcedure = {
  bootstrap: publicProcedure
    // `session` omitted means "whatever the default session is" — the same
    // resolution `chat.defaultSession` does.
    .input(historySliceSchema.extend({ session: z.string().optional() }))
    .query(async ({ input, ctx }): Promise<ChatBootstrap> => {
      const { session, ...slice } = input;
      const sessionId = session ?? (await getMostActive(ctx.boxRoot));
      if (sessionId === null) {
        return { sessionId: null, history: null, status: readSessionStatus(ctx.boxRoot, null) };
      }
      const history = await loadSessionHistory(ctx.boxRoot, { ...slice, session: sessionId });
      return { sessionId, history, status: readSessionStatus(ctx.boxRoot, sessionId) };
    }),
};

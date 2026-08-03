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
  loadHistoryForSession,
  type SessionHistory,
} from "./chat-session-procedures.js";
import { readSessionStatus, type ChatSessionStatus } from "./chat-control-procedures.js";
import { titleForSession } from "../../../core/chat/session/list.js";

export interface ChatBootstrap {
  /** The resolved session, or null when the box has no chat session yet. */
  sessionId: string | null;
  /** Null exactly when `sessionId` is null — there is no history to load. */
  history: SessionHistory | null;
  /**
   * The session's *editorial* title — the husk card's `title`, or null when
   * it has none (or `sessionId` is null). Deliberately NOT the pickers'
   * first-message/id fallback chain: a fabricated title reads wrong on the
   * app bar's session chip, which shows an icon face until the session has
   * a real name (boxholder call, 2026-08-03).
   */
  label: string | null;
  status: ChatSessionStatus;
}

export const chatBootstrapProcedure = {
  bootstrap: publicProcedure
    // `session` omitted means "whatever the default session is" — the same
    // resolution `chat.defaultSession` does. An empty string is not a session
    // id: accepting one would report `sessionId: ""` alongside a status that
    // (correctly) says there's no session.
    .input(z.object({ session: z.string().min(1).optional(), slice: historySliceSchema }))
    .query(async ({ input, ctx }): Promise<ChatBootstrap> => {
      const { session, slice } = input;
      const resolved = session ?? (await getMostActive(ctx.boxRoot));
      // The persisted pointer is a file another process wrote; an empty id in
      // it means "none", not a session named "".
      const sessionId = resolved === "" ? null : resolved;
      if (sessionId === null) {
        return {
          sessionId: null,
          history: null,
          label: null,
          status: readSessionStatus(ctx.boxRoot, null),
        };
      }
      const [history, label] = await Promise.all([
        loadHistoryForSession(ctx.boxRoot, { session: sessionId, slice }),
        titleForSession(ctx.boxRoot, sessionId),
      ]);
      return { sessionId, history, label, status: readSessionStatus(ctx.boxRoot, sessionId) };
    }),
};

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
import { readAcceptedMessages, type AcceptedMessage } from "../../../core/chat/session/accepted-messages.js";
import { publicProcedure } from "../trpc.js";
import { getMostActive } from "../../../core/chat/session/history.js";
import { historySliceSchema, loadHistoryForSession, type SessionHistory } from "./chat-session-procedures.js";
import { readSessionStatus, type ChatSessionStatus } from "./chat-control-procedures.js";
import { titleForSession } from "../../../core/chat/session/list.js";
import { resolveSessionAvailability } from "../../../core/chat/session/availability.js";
import { getChatRuntime } from "../../chat-runtime.js";
import { TRPCError } from "@trpc/server";

interface ChatBootstrapBase {
  /**
   * The session's *editorial* title — the husk card's `title`, or null when
   * it has none (or `sessionId` is null). Deliberately NOT the pickers'
   * first-message/id fallback chain: a fabricated title reads wrong on the
   * app bar's session chip, which shows an icon face until the session has
   * a real name (boxholder call, 2026-08-03).
   */
  label: string | null;
  status: ChatSessionStatus;
  /**
   * Messages this box has ACCEPTED but has not yet written into a transcript.
   *
   * A send is answered 200 once it is durably recorded, which happens before
   * the engine starts — so a page loaded in that window would otherwise show a
   * conversation missing the question the box already promised to have, or (for
   * a message that opened a new chat, before an id exists) no conversation at
   * all. `history` is what is durable; this is what is owed. Kept separate
   * rather than merged into `entries` so the client can render it as pending
   * and retire it through the same `reconcilePending` it applies to its own
   * optimistic copies — the entries here are deliberately NOT filtered against
   * the history, because that comparison already exists client-side and a
   * second implementation could disagree with it.
   */
  pending: AcceptedMessage[];
}

export type ChatBootstrap =
  | (ChatBootstrapBase & {
      kind: "empty";
      sessionId: null;
      history: null;
      label: null;
    })
  | (ChatBootstrapBase & {
      kind: "resumable";
      sessionId: string;
      history: SessionHistory;
    })
  | (ChatBootstrapBase & {
      kind: "unavailable";
      sessionId: string;
      history: null;
      reason: "missing-local-transcript" | "deletion-in-progress";
      huskPath: string | null;
    });

export const chatBootstrapProcedure = {
  bootstrap: publicProcedure
    // `session` omitted means "whatever the default session is" — the same
    // resolution `chat.defaultSession` does. An empty string is not a session
    // id: accepting one would report `sessionId: ""` alongside a status that
    // (correctly) says there's no session.
    .input(
      z.object({
        session: z.string().min(1).optional(),
        slice: historySliceSchema,
      }),
    )
    .query(async ({ input, ctx }): Promise<ChatBootstrap> => {
      const { session, slice } = input;
      const resolved = session ?? (await getMostActive(ctx.boxRoot));
      // The persisted pointer is a file another process wrote; an empty id in
      // it means "none", not a session named "".
      const sessionId = resolved === "" ? null : resolved;
      // The acceptance record is read against whatever history goes back with
      // it: the entries already there are each accepted message's
      // reconciliation baseline, so an old turn repeating the same words cannot
      // stand in for the echo it is still waiting for.
      const acceptedFor = (knownUuids: string[]): AcceptedMessage[] =>
        readAcceptedMessages(ctx.eventBus, {
          sessionId,
          now: new Date(),
          viewerEmail: ctx.user?.email ?? null,
          knownUuids,
        });
      if (sessionId === null) {
        // "No session" is the reload that loses the most: a first message is
        // accepted before the engine assigns an id, so there is nothing yet for
        // the page to resolve. The acceptance record is the only evidence the
        // message exists, and it is what makes this an empty chat that is
        // visibly waiting rather than one that never happened.
        return {
          kind: "empty",
          sessionId: null,
          history: null,
          label: null,
          status: await readSessionStatus(ctx.boxRoot, null),
          pending: acceptedFor([]),
        };
      }
      const runtime = getChatRuntime(ctx.boxRoot);
      if (runtime === undefined) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Chat runtime not initialized for this box",
        });
      }
      const availability = await resolveSessionAvailability({
        boxRoot: ctx.boxRoot,
        sessionId,
        registry: runtime.registry,
      });
      if (availability.kind === "unavailable") {
        return {
          kind: "unavailable",
          sessionId,
          history: null,
          label: await titleForSession(ctx.boxRoot, sessionId),
          status: await readSessionStatus(ctx.boxRoot, sessionId),
          reason: availability.reason,
          huskPath: availability.huskPath,
          pending: acceptedFor([]),
        };
      }
      const [history, label] = await Promise.all([loadHistoryForSession(ctx.boxRoot, { session: sessionId, slice }), titleForSession(ctx.boxRoot, sessionId)]);
      return {
        kind: "resumable",
        sessionId,
        history,
        label,
        status: await readSessionStatus(ctx.boxRoot, sessionId),
        pending: acceptedFor(history.entries.map((entry) => entry.uuid)),
      };
    }),
};

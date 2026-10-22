// # Chat machine — a new chat's dropped live view must still settle
//
// In a new chat (`sessionInput: "new"`) the session id arrives on the turn
// stream's first frame (`system/init` -> SESSION_ASSIGNED). If the live view
// drops before that frame, a refresh asks the box for the accepted turn's
// session id (`events.turnSession`, keyed by the TURN_ACCEPTED turn id) and
// adopts it, so `replyLost` settles against real history
// (issues/bugs/2026-10-20-new-chat-dropped-stream-warning-can-stick.md).
// The `chat-session-assigned` bus event only reaches the controller pool
// (`pool.markReady`), never this machine.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { eventually } from "@ianbicking/tap-check/check";
import { createActor, fromPromise, fromCallback } from "xstate";
import { chatMachine } from "../../../src/machines/chatMachine/machine.js";
import type { ChatController } from "../../../src/components/chat/conversation/controller-pool/pool.js";
import type { PendingSessionEntry, SessionEntry } from "../../../src/api.js";
import type { HistoryInput } from "../../../src/machines/chat-types.js";

interface History { entries: SessionEntry[]; total: number; sessionId: string | null; running: boolean; busy: boolean }
const EMPTY_NEW: History = { entries: [], total: 0, sessionId: null, running: false, busy: false };
const NO_PENDING: PendingSessionEntry[] = [];
const entry = ({ uuid, type, text }: { uuid: string; type: SessionEntry["type"]; text: string }): SessionEntry =>
  ({ uuid, type, timestamp: "2026-10-20T00:00:00.000Z", content: [{ type: "text", text }] });
const reply = [entry({ uuid: "m1", type: "user", text: "hi" }), entry({ uuid: "a1", type: "assistant", text: "hello" })];

// The box's view of turn t1: its session id once `system/init` reached the box.
const box: { turnSession: string | null } = { turnSession: null };

// fetchHistory mirrors the real one: "new" looks the accepted turn up; a real
// id (or the looked-up one) has the reply.
async function newChat(): Promise<ChatController> {
  box.turnSession = null;
  const actor = createActor(
    chatMachine.provide({
      actors: {
        fetchInitial: fromPromise(async () => ({ ...EMPTY_NEW, pending: NO_PENDING })),
        fetchHistory: fromPromise<History, HistoryInput>(async ({ input }) => {
          const sessionId = input.sessionInput !== "new" ? input.sessionInput : input.turnId === "t1" ? box.turnSession : null;
          return sessionId === null
            ? EMPTY_NEW
            : { entries: reply, total: 2, sessionId, running: false, busy: false };
        }),
        stream: fromCallback(() => {}),
      },
    }),
    { input: { sessionInput: "new" } },
  );
  actor.start();
  await Promise.resolve();
  return actor;
}
const idle = () => ({ label: "settled" });

// ## The drop precedes the session id; the reply lands later
//
// The turn stream fails before `system/init`, so no SESSION_ASSIGNED is sent.
// The box gets init after the drop; the reply lands and `chat-complete`
// triggers REFRESH. The chat adopts the turn's session and the warning clears.
void test("The turn stream fails before system/init; the reply lands later and chat-complete refreshes", async (t) => {
  const actor = await newChat();
  actor.send({ type: "SEND", message: "hi", messageId: "m1" });
  actor.send({ type: "TURN_ACCEPTED", turnId: "t1" });
  actor.send({ type: "STREAM_LOST", reason: "Active connection is not open" });
  await eventually(() => actor.getSnapshot().value === "idle", idle());
  t.check(actor.getSnapshot().context.replyLost, true);

  box.turnSession = "s1";
  actor.send({ type: "REFRESH" }); // chat-complete, after the reply landed
  await eventually(() => actor.getSnapshot().value === "idle", idle());
  const { replyLost, error, sessionInput, sessionId, newChatTurnId } = actor.getSnapshot().context;
  t.check(
    { replyLost, error, sessionInput, sessionId, newChatTurnId, messages: actor.getSnapshot().context.messages.map((m) => m.uuid) },
    { replyLost: false, error: null, sessionInput: "s1", sessionId: "s1", newChatTurnId: undefined, messages: ["m1", "a1"] },
  );
});

// ## The box already knows the session when the drop's own refresh runs
void test("The turn's session is already known at the drop; that refresh settles it", async (t) => {
  const actor = await newChat();
  box.turnSession = "s1";
  actor.send({ type: "SEND", message: "hi", messageId: "m1" });
  actor.send({ type: "TURN_ACCEPTED", turnId: "t1" });
  actor.send({ type: "STREAM_LOST", reason: "Active connection is not open" });
  await eventually(() => actor.getSnapshot().value === "idle", idle());
  const { replyLost, sessionId } = actor.getSnapshot().context;
  t.check({ replyLost, sessionId }, { replyLost: false, sessionId: "s1" });
});

// ## TURN_ACCEPTED after the session is known is ignored
void test("TURN_ACCEPTED is held only while the chat is new", async (t) => {
  const actor = await newChat();
  actor.send({ type: "SESSION_ASSIGNED", sessionId: "s1" });
  actor.send({ type: "TURN_ACCEPTED", turnId: "t2" });
  t.check(actor.getSnapshot().context.newChatTurnId, undefined);
});

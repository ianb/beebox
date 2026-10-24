// # `events.turnSession` — the session id an accepted turn runs under
//
// A new chat holds only the turn id from its send's ack. If the turn stream
// drops before `system/init`, the chat asks this query for the session id.
// It is null until init reaches the box, and null for a turn the box does not
// have (never created, or GC'd after its reconnect window).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { eventsRouter } from "../../../../src/webapp/trpc/routers/events.js";
import { createTurnBuffer } from "../../../../src/core/chat/turn-buffer.js";
import { trpcContext } from "../../../helpers/trpc-context.js";

const caller = eventsRouter.createCaller(trpcContext({ boxRoot: "/box-unused" }));

void test("A turn's session id is null before init and set after it", async (t) => {
  const buffer = createTurnBuffer("turn-session-1");
  t.check(await caller.turnSession({ turnId: "turn-session-1" }), { sessionId: null });
  buffer.push({ type: "system", subtype: "init", session_id: "s1" });
  t.check(await caller.turnSession({ turnId: "turn-session-1" }), { sessionId: "s1" });
});

void test("An unknown turn has no session id", async (t) => {
  t.check(await caller.turnSession({ turnId: "turn-session-missing" }), { sessionId: null });
});

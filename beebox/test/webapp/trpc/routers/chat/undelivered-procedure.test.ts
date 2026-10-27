// # chat.discardUndelivered
//
// `docs/plans/chat-not-delivered.md`, Track 1: the person removes a message the
// box dropped before the agent got it. The procedure answers NOT_FOUND unless
// an undelivered marker exists, so it cannot hide a delivered message.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
import { TRPCError } from "@trpc/server";
import { createEventBus } from "../../../../../src/core/event-bus/core.js";
import { appRouter } from "../../../../../src/webapp/trpc/routers.js";
import { trpcContext } from "../../../../helpers/trpc-context.js";
import { makeTmpBox } from "../../../../helpers/test-helpers.js";

void test("discard records a marker for an undelivered message and refuses any other", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const eventBus = createEventBus(box.root);
  t.teardown(() => { eventBus.close(); });
  eventBus.emit("chat-user-message-undelivered", { sessionId: "s1", messageId: "m-oat", timestamp: "2026-10-27T09:00:00.000Z" });
  const caller = appRouter.createCaller(trpcContext({ boxRoot: box.root, eventBus }));

  t.check(await caller.chat.discardUndelivered({ sessionId: "s1", messageId: "m-oat" }), { ok: true });
  // "m-eggs" has no undelivered marker: the agent may have received it.
  const refusal = await caller.chat.discardUndelivered({ sessionId: "s1", messageId: "m-eggs" }).then(
    () => "accepted",
    (error: unknown) => (error instanceof TRPCError ? `${error.code}: ${error.message}` : "other"),
  );
  t.check(refusal, "NOT_FOUND: This message is not marked as undelivered");
  t.check(eventBus.readRecent({ event: "chat-user-message-discarded", limit: 10 }).map((e) => e.data), [
    { sessionId: "s1", messageId: "m-oat", timestamp: isoDate() }, // stamped with the real clock
  ]);
});

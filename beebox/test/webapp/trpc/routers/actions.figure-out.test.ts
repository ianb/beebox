// # tRPC `actions.figureOut`: put the question away, start a background chat
//
// Continues [actions.test.ts](actions.test.ts). The button runs the dismiss
// transition, emits `question-dismissed`, then delivers one message into a new
// chat that names the card. A delivery failure leaves the card dismissed and
// returns an error; a card that is not pending is refused before any chat starts.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, str } from "@ianbicking/tap-check/check";
import { TRPCError } from "@trpc/server";
import { actionsRouter } from "../../../../src/webapp/trpc/routers/actions.js";
import { setChatRuntime, clearChatRuntime, type ChatRuntime } from "../../../../src/webapp/chat-runtime.js";
import { ChatSessionRegistry } from "../../../../src/core/chat/session/registry/core.js";
import { ChatScheduleManager } from "../../../../src/core/chat/schedules/core.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import type { EventBus } from "../../../../src/core/event-bus/core.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";

const CARD = "_bookkeeping/questions/Receipt.question.card";
const PENDING = "---\nprompt: Where does this receipt go?\ninput:\n  type: text\n---\n";
const DISMISSED = str`---
type: question
prompt: Where does this receipt go?
input:
  type: text
dismissed-at: ${isoDate()}
---
`;

async function fixture(t: Test, card: string) {
  const box = await makeTmpBox({ git: true });
  await box.write(CARD, card);
  const backend = createFakeChatBackend();
  const registry = new ChatSessionRegistry(box.root, { backend });
  const events: { event: string; data: unknown }[] = [];
  const eventBus: EventBus = {
    emit: (event, data) => { events.push({ event, data }); return 0; },
    emitTransient: () => {},
    readSince: () => [],
    readRecent: () => [],
    subscribe: () => ({ unsubscribe: () => {} }),
    prune: () => 0,
    close: () => {},
  };
  const runtime: ChatRuntime = {
    registry,
    scheduleManager: Object.create(ChatScheduleManager.prototype),
    wireSession: () => {},
    maintenance: Promise.resolve(),
    resolveSendTarget: () => { throw new Error("not used"); },
    sendUserMessage: () => { throw new Error("not used"); },
  };
  setChatRuntime(box.root, runtime);
  t.teardown(async () => {
    clearChatRuntime(box.root);
    await registry.shutdown();
    await box.cleanup();
  });
  const ctx: TrpcContext = trpcContext({ boxRoot: box.root, boxSlug: "t", eventBus });
  return { box, backend, events, caller: actionsRouter.createCaller(ctx) };
}

async function attempt(fn: () => Promise<unknown>) {
  const { error } = console;
  console.error = () => {};
  try {
    await fn();
    return "unexpected success";
  } catch (e) {
    return e instanceof TRPCError ? `${e.code}: ${e.message}` : String(e);
  } finally {
    console.error = error;
  }
}

// ## The question is put away and the message names the card
void test("The question is put away and the message names the card", async (t) => {
  const { box, backend, events, caller } = await fixture(t, PENDING);

  const res = await caller.figureOut({ questionPath: CARD });
  t.check(res, { sessionId: null });

  t.check(await box.read(CARD), DISMISSED);
  t.check(events.map((e) => e.event), ["question-dismissed", "chat-user-message"]);
  // The chat adds a leading `<chat-app/>` line; the delivered message is the rest.
  t.check(
    backend.runs[0]?.sent.flat().map((block) => block.type === "text" ? block.text.split("\n").slice(1).join("\n") : null),
    [`Figure out the question at ${CARD}, which the person handed to you from the question card. Use the figure-it-out skill.`],
  );
});

// ## A delivery failure leaves the card dismissed and returns an error
void test("A delivery failure leaves the card dismissed and returns an error", async (t) => {
  const { box, backend, caller } = await fixture(t, PENDING);
  backend.failNextStart = new Error("spawn failed");

  t.check(
    await attempt(() => caller.figureOut({ questionPath: CARD })),
    any(String).matches(/^INTERNAL_SERVER_ERROR: The question is put away, but the background chat did not start/),
  );
  t.check(await box.read(CARD), DISMISSED);
});

// ## A card that is not pending is refused and no chat starts
void test("A card that is not pending is refused and no chat starts", async (t) => {
  const { backend, caller } = await fixture(t, PENDING.replace("---\n", "---\ndismissed-at: 2026-10-01T09:00:00-07:00\n"));

  t.check(
    await attempt(() => caller.figureOut({ questionPath: CARD })),
    "BAD_REQUEST: Question is dismissed, not pending; only a pending question can be dismissed",
  );
  t.check(backend.runs, []);
});

// ## Without a chat runtime nothing is put away
void test("Without a chat runtime nothing is put away", async (t) => {
  const { box, caller } = await fixture(t, PENDING);
  clearChatRuntime(box.root);

  t.check(
    await attempt(() => caller.figureOut({ questionPath: CARD })),
    "PRECONDITION_FAILED: Chat runtime not initialized for this box",
  );
  t.check(await box.read(CARD), PENDING);
});

// # chat.addCheckIn and chat.cancelCheckIn
//
// `bbx remind --here` sets a check-in from inside a chat's turn through these
// procedures, so a refusal reaches the agent while it can still tell the user.
// Cancel is scoped to the conversation: another chat's check-in with the same
// label stays. A chat that cannot be resumed (deleted, archived) gets none.

import { test } from "tap";
import "agent-doctest/tap";
import { TRPCError } from "@trpc/server";
import { ChatSession } from "../../../../../src/core/chat/session/run/core.js";
import { ChatSessionRegistry } from "../../../../../src/core/chat/session/registry/core.js";
import { ChatScheduleManager } from "../../../../../src/core/chat/schedules/core.js";
import type { ChatRuntime } from "../../../../../src/webapp/chat-runtime.js";
import { clearChatRuntime, setChatRuntime } from "../../../../../src/webapp/chat-runtime.js";
import { appRouter } from "../../../../../src/webapp/trpc/routers.js";
import { trpcContext } from "../../../../helpers/trpc-context.js";
import { makeTmpBox } from "../../../../helpers/test-helpers.js";
import { createFakeChatBackend } from "../../../../../src/services/claude-chat/core.js";
import { getSessionLogPath } from "../../../../../src/core/chat/session/transcript-paths.js";
import { plainTestPrompt } from "../../../../helpers/chat-session-spawner-helpers.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

async function setup(teardown: (fn: () => Promise<void>) => void) {
  const box = await makeTmpBox();
  const scheduleManager = new ChatScheduleManager(box.root, { onFire: () => {} });
  const registry = new ChatSessionRegistry(box.root, {
    backend: createFakeChatBackend(),
    buildSessionOptions: () => ({ systemPrompt: plainTestPrompt, skipBootstrap: true }),
  });
  for (const sessionId of [A, B]) {
    const logPath = getSessionLogPath(box.root, sessionId);
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(logPath, "{}\n");
  }
  // The procedures read `scheduleManager` and `registry`; the session is a prototype-backed stand-in.
  const runtime: ChatRuntime = {
    registry,
    scheduleManager,
    wireSession: () => {},
    maintenance: Promise.resolve(),
    resolveSendTarget: async () => ({ ok: true, target: { session: Object.create(ChatSession.prototype), id: null } }),
    sendUserMessage: async () => ({ status: 200, body: { queued: true } }),
  };
  setChatRuntime(box.root, runtime);
  teardown(async () => { clearChatRuntime(box.root); scheduleManager.stopAll(); registry.shutdown(); await box.cleanup(); });
  return { caller: appRouter.createCaller(trpcContext({ boxRoot: box.root, isAuthenticatedOwner: true })), scheduleManager };
}

const rice = { label: "rice", alarm: true, announce: null, content: "check the rice" };

void test("a check-in is set in its conversation; cancel touches only that one", async (t) => {
  const { caller, scheduleManager } = await setup((fn) => t.teardown(fn));
  const set = await caller.chat.addCheckIn({ ...rice, sessionId: A, in: "20m" });
  await caller.chat.addCheckIn({ ...rice, sessionId: B, in: "20m" });
  t.check(set.label, "rice");
  t.check(await caller.chat.cancelCheckIn({ sessionId: A, label: "rice" }), { ok: true });
  t.check(await caller.chat.cancelCheckIn({ sessionId: A, label: "rice" }), { ok: false });
  t.check(scheduleManager.getActive().map((s) => s.sessionId), [B]);
});

void test("an over-cap or unreadable duration is refused with the reason", async (t) => {
  const { caller } = await setup((fn) => t.teardown(fn));
  const code = async (input: string): Promise<string> => {
    try {
      await caller.chat.addCheckIn({ ...rice, sessionId: A, in: input });
      return "set";
    } catch (error) {
      return error instanceof TRPCError ? `${error.code}: ${error.message}` : "other";
    }
  };
  t.check(await code("30d"), "BAD_REQUEST: A check-in can be at most 12h (asked for 43200m); for longer, set a reminder with bbx remind --in or --at");
  t.check((await code("soon")).split(":")[0], "BAD_REQUEST");
});

void test("a conversation being deleted cannot get a check-in", async (t) => {
  const { caller, scheduleManager } = await setup((fn) => t.teardown(fn));
  scheduleManager.blockForDeletion(A);
  await t.checkThrows(() => caller.chat.addCheckIn({ ...rice, sessionId: A, in: "5m" }), "TRPCError: Cannot schedule work for a conversation being deleted");
});

void test("a chat with no transcript to resume gets no check-in", async (t) => {
  const { caller } = await setup((fn) => t.teardown(fn));
  await t.checkThrows(
    () => caller.chat.addCheckIn({ ...rice, sessionId: "33333333-3333-4333-8333-333333333333", in: "5m" }),
    "TRPCError: Conversation 33333333-3333-4333-8333-333333333333 has ended or cannot be resumed (missing-local-transcript)",
  );
});

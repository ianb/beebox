// `chatPresence.watch`: subscribing is being present. Each subscriber hears
// who else has the same chat open; the box's own agent and an identity-less
// caller hear an empty list and are never shown to anyone; ending the
// subscription (the WebSocket closing) removes the person.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { appRouter } from "../../../src/webapp/trpc/routers.js";
import { trpcContext } from "../../helpers/trpc-context.js";
import type { TrpcContext } from "../../../src/webapp/trpc/context.js";
import type { ChatPresenceFrame } from "../../../src/core/chat/presence/room.js";

const boxRoot = "/tmp/bbx-chat-presence-router-test";
const sessionId = "0b9d6a5e-3c1f-4e8a-9a51-2f4d7c6b8e10";
const priya = { email: "priya@example.com", name: "Priya Marlowe" };
const tomas = { email: "tomas@example.com", name: "Tomas Marlowe" };

/**
 * One subscription: its frames, and the close that ends it. A direct caller's
 * subscription joins only when its first frame is pulled, so each test pulls
 * a newcomer's first frame before reading what the others heard.
 */
async function watch(over: Partial<TrpcContext>, room?: string) {
  const chat = room ?? sessionId;
  const controller = new AbortController();
  const caller = appRouter.createCaller(trpcContext({ boxRoot, ...over }), { signal: controller.signal });
  const frames = (await caller.chatPresence.watch({ sessionId: chat }))[Symbol.asyncIterator]();
  return {
    next: async (): Promise<ChatPresenceFrame> => {
      const r = await frames.next();
      if (r.done === true) throw new Error("subscription ended");
      return r.value;
    },
    // The WebSocket handler aborts and then returns the iterator; a direct caller does both.
    close: async () => {
      controller.abort();
      await frames.return?.();
    },
  };
}

void test("two people in one chat see each other, and a leave reaches the one who stays", async (t) => {
  const p = await watch({ user: priya });
  t.check(await p.next(), { t: "others", people: [] });
  const tm = await watch({ user: tomas, actor: "device" });
  t.check(await tm.next(), { t: "others", people: [priya] });
  t.check(await p.next(), { t: "others", people: [tomas] });
  await tm.close();
  t.check(await p.next(), { t: "others", people: [] });
  await p.close();
});

void test("the agent and a caller with no identity are not present", async (t) => {
  const p = await watch({ user: priya });
  t.check(await p.next(), { t: "others", people: [] });
  // The agent browsing as the owner carries the owner's identity but acts as the agent.
  const agent = await watch({ user: tomas, actor: "agent" });
  t.check(await agent.next(), { t: "others", people: [] });
  const open = await watch({ user: null, actor: "open" });
  t.check(await open.next(), { t: "others", people: [] });
  // Priya hears nothing about either; a third, real person is her next frame.
  const odette = await watch({ user: { email: "odette@example.com", name: "Odette Marlowe" } });
  t.check(await odette.next(), { t: "others", people: [priya] });
  t.check(await p.next(), { t: "others", people: [{ email: "odette@example.com", name: "Odette Marlowe" }] });
  await Promise.all([p, agent, open, odette].map((s) => s.close()));
});

void test("a different chat is a different room", async (t) => {
  const p = await watch({ user: priya });
  t.check(await p.next(), { t: "others", people: [] });
  const elsewhere = await watch({ user: tomas }, "7f3e2a1b-0c9d-4e8f-a7b6-5c4d3e2f1a0b");
  t.check(await elsewhere.next(), { t: "others", people: [] });
  await p.close();
  await elsewhere.close();
});

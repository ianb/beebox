// # POST /api/chat/strip
//
// The server half of `bbx chat strip`. Agent-bearer auth like `/api/chat/ui/request`;
// the session must be live; the card must resolve and be strip-capable. A set
// reaches the session's feature map, which `wireSession` bridges to the bus.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { getOrCreateAgentToken } from "../../../../src/core/agent/token.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { getChatRuntime } from "../../../../src/webapp/chat-runtime.js";
import { makeTestServer } from "../../../helpers/test-route-server.js";

const SESSION = "11111111-1111-4111-8111-111111111111";

async function setup(t: Test) {
  const ctx = await makeTestServer({ chatBackend: createFakeChatBackend() });
  t.teardown(async () => { await ctx.cleanup(); });
  await ctx.seed("_content/Walk.tour.card", "---\n---\n## One\n");
  await ctx.seed("_content/Plain.doc.card", "---\n---\nhello\n");
  const runtime = getChatRuntime(ctx.boxRoot);
  if (runtime === undefined) throw new Error("no chat runtime");
  const headers = { authorization: `Bearer ${getOrCreateAgentToken(ctx.boxRoot)}` };
  const post = (card: string | null) =>
    ctx.request({ method: "POST", url: "/api/chat/strip", payload: { session: SESSION, card }, headers });
  return { ctx, runtime, post };
}

void test("a request without the agent bearer is forbidden", async (t) => {
  const { ctx } = await setup(t);
  t.check(await ctx.request({ method: "POST", url: "/api/chat/strip", payload: { session: SESSION, card: null } }), {
    statusCode: 403,
    body: { error: "forbidden", message: "Strip changes are agent-initiated (loopback bearer required)" },
  });
});

void test("a session that is not live gets 404 no-session", async (t) => {
  const { post } = await setup(t);
  t.check(await post("_content/Walk.tour.card"), {
    statusCode: 404,
    body: { error: "no-session", message: `session "${SESSION}" is not live` },
  });
});

void test("set, then clear, changes the session feature and broadcasts it", async (t) => {
  const { ctx, runtime, post } = await setup(t);
  const session = runtime.registry.getOrCreate(SESSION);
  const broadcast: Array<Record<string, string>> = [];
  ctx.eventBus.subscribe({
    listener: (e) => {
      if (e.event === "chat-features-changed") broadcast.push(e.data.features);
    },
  });
  t.check(await post("_content/Walk.tour.card"), { statusCode: 200, body: { strip: "/_content/Walk.tour.card" } });
  t.check(session.getFeatures().strip, "/_content/Walk.tour.card");
  t.check(broadcast, [{ narration: "off", prose: "on", strip: "/_content/Walk.tour.card" }]);
  t.check(await post(null), { statusCode: 200, body: { strip: "none" } });
  t.check(session.getFeatures().strip, "none");
});

void test("refusals return 422 with the message", async (t) => {
  const { runtime, post } = await setup(t);
  runtime.registry.getOrCreate(SESSION);
  t.check(await post("_content/Nope.tour.card"), {
    statusCode: 422,
    body: { error: "not-found", message: "no card at _content/Nope.tour.card" },
  });
  t.check(await post("_content/Plain.doc.card"), {
    statusCode: 422,
    body: { error: "not-strip-capable", message: "doc cards cannot be shown in the strip; strip-capable types in this box: tour" },
  });
});

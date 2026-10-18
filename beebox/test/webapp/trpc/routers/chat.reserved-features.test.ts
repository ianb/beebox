// # Feature seeds across a reserved chat
//
// A Claude chat gets a client-coined id before its first message. Reserving that
// id captures the landmark's feature seeds, but does not write chat history yet.
// The feature read used by a page reload must therefore consult the reservation:
// disk alone has no row and would reset the UI to the registry default (`off`).

import { test } from "tap";
import "agent-doctest/tap";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTestServer, type TestServer } from "../../../helpers/test-route-server.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { appendHistory, getFeaturesForSession, updateFeaturesForSession } from "../../../../src/core/chat/session/history.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { getChatRuntime } from "../../../../src/webapp/chat-runtime.js";

async function waitFor(condition: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition did not become true");
}

function caller(server: TestServer) {
  const ctx: TrpcContext = trpcContext({
    boxRoot: server.boxRoot,
    eventBus: server.eventBus,
    isAuthenticatedOwner: true,
  });
  return appRouter.createCaller(ctx);
}

// ## Landmark seed on a reserved chat
//
// The root landmark seeds narration `on`. The page immediately receives a
// reserved id; reading that id must still report the seeded value.
void test("The root landmark seeds narration on.", async (t) => {
  t.teardown(async () => {
    try {
      await server.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L42
  const backend = createFakeChatBackend();
  const realStart = backend.start.bind(backend);
  const runStarted = new Promise<void>((resolve) => {
    backend.start = (opts) => { const run = realStart(opts); resolve(); return run; };
  });
  const server = await makeTestServer({ chatBackend: backend });
  const api = caller(server);
  await server.seed(
    "_content/Box.landmark.card",
    "---\nnavigation:\n  label: Box\n  chat-app:\n    narration: on\n---\n",
  );

  // doctest:L54
  const inherited = "11111111-1111-4111-8111-111111111111";
  await api.chat.reserveSession({ sessionId: inherited, contextDir: "", engine: "claude" });
  t.check(await api.chat.features({ session: inherited }), { features: { narration: "on", prose: "on" } });

  // An explicit per-chat `off` overrides the seeded `on` and survives the same
  // reload read even though the chat has not started and still has no history row.

  // doctest:L64
  await api.chat.setFeature({ session: inherited, feature: "narration", value: "off" });
  t.check(await api.chat.features({ session: inherited }), { features: { narration: "off", prose: "on" } });
  t.check(await getFeaturesForSession(server.boxRoot, inherited), null);

  // ## A changed landmark seeds only new chats
  //
  // Changing the landmark does not rewrite the earlier chat's features; a newly
  // reserved chat gets the new seed.

  // doctest:L78
  await server.seed(
    "_content/Box.landmark.card",
    "---\nnavigation:\n  label: Box\n  chat-app:\n    prose: off\n---\n",
  );

  // doctest:L83
  const proseOff = "22222222-2222-4222-8222-222222222222";
  await api.chat.reserveSession({ sessionId: proseOff, contextDir: "", engine: "claude" });
  t.check(await api.chat.features({ session: inherited }), { features: { narration: "off", prose: "on" } });
  t.check(await api.chat.features({ session: proseOff }), { features: { narration: "off", prose: "off" } });

  // Once that reserved chat starts, later toggles leave the reservation path and
  // persist to history. The now-released reservation must not keep swallowing
  // updates into its orphaned in-memory record.

  // doctest:L97
  const accepted = await server.request({
    method: "POST",
    url: "/api/chat/send",
    payload: { session: proseOff, message: "hello", messageId: "seed-start" },
  });
  // The run starts behind a bootstrap git commit whose time depends on host
  // load (over 10s on 2026-10-11), so wait for the backend to start, then
  // give only the history write that follows it the deadline.
  await runStarted;
  await waitFor(async () =>
    getChatRuntime(server.boxRoot)?.registry.getReservation(proseOff) === null
      && (await getFeaturesForSession(server.boxRoot, proseOff))?.prose === "off"
  );
  await api.chat.setFeature({ session: proseOff, feature: "prose", value: "on" });
  t.check(accepted.statusCode, 200);
  t.check(await api.chat.features({ session: proseOff }), { features: { narration: "off", prose: "on" } });
  t.check(await getFeaturesForSession(server.boxRoot, proseOff), { prose: "on" });

  // ## Persisted state outranks an unloaded live session
  //
  // An existing chat can acquire a live registry entry through another control
  // before its feature store has loaded. That empty in-memory store must not mask
  // the persisted value on reload.

  // doctest:L127
  const started = "33333333-3333-4333-8333-333333333333";
  await appendHistory(server.boxRoot, { sessionId: started, engine: "claude" });
  await updateFeaturesForSession(server.boxRoot, {
    sessionId: started,
    updates: { narration: "on" },
    engine: "claude",
  });
  await api.chat.setModel({ session: started, model: "claude-sonnet-5-5" });
  t.check(await api.chat.features({ session: started }), { features: { narration: "on", prose: "on" } });
});

// # A queued message that a stop drops is recorded as undelivered
//
// `issues/closed/bugs/2026-10-14-busy-rejected-send-recorded-then-orphaned.md`, the
// dropped-queue re-encounter; `docs/implemented-plans/chat-not-delivered.md`, Track 1. A
// send that arrives during a streaming turn is accepted (`{queued: true}`, the
// `chat-user-message` row) and queued. `stop()` empties the queue, and before
// this change nothing recorded that, so the chat showed the message as queued
// until the 10-minute acceptance window retired it. Now the route layer records
// `chat-user-message-undelivered` for each dropped message the client named.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { eventually } from "@ianbicking/tap-check/check";
import { makeTestServer } from "../../../helpers/test-route-server.js";
import { createFakeChatBackend, type FakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { getChatRuntime } from "../../../../src/webapp/chat-runtime.js";
import { readAcceptedMessages } from "../../../../src/core/chat/session/accepted-messages.js";

function engineReceived(backend: FakeChatBackend): string[] {
  return backend.runs.flatMap((run) => run.sent.flatMap((blocks) => blocks.flatMap((b) => b.type === "text" ? [b.text] : [])));
}

async function setup(t: Test) {
  const backend = createFakeChatBackend();
  const ctx = await makeTestServer({ chatBackend: backend });
  t.teardown(async () => { await ctx.cleanup(); });
  const runtime = getChatRuntime(ctx.boxRoot);
  if (runtime === undefined) throw new Error("no chat runtime");
  const resolved = await runtime.resolveSendTarget({ sessionParam: "new", contextDir: undefined, requestSeedFeatures: undefined, exactSession: false });
  if (!resolved.ok) throw new Error(resolved.error);
  const send = (message: string, messageId: string) =>
    runtime.sendUserMessage({ target: resolved.target, message, messageId, user: null, channel: "ios-native" });
  const has = (text: string): boolean => engineReceived(backend).some((m) => m.includes(text));
  const undelivered = () => ctx.eventBus.readRecent({ event: "chat-user-message-undelivered", limit: 10 })
    .map((e) => (e.event === "unknown" ? e : { messageId: e.data.messageId }));
  return { ctx, backend, runtime, session: resolved.target.session, send, has, undelivered };
}

// ## The issue's probe: a queued send, then a server shutdown
void test("a send queued behind a streaming turn is marked undelivered when the server shuts down", async (t) => {
  const { ctx, runtime, send, has, undelivered } = await setup(t);
  await send("first message", "m1");
  await eventually(() => has("first message"), { label: "first delivered", timeoutMs: 120_000 });
  const queued = await send("add oat milk", "m-oat");
  await runtime.registry.shutdown();

  // A reload an hour later still sees it, marked: the 10-minute window does not apply.
  const hourLater = new Date(Date.now() + 60 * 60 * 1000);
  const accepted = readAcceptedMessages(ctx.eventBus, { sessionId: null, now: hourLater, viewerEmail: null, history: [] });
  t.check({
    queued: queued.body,
    undelivered: undelivered(),
    pending: accepted.map(({ messageId, undelivered: mark }) => ({ messageId, undelivered: mark })),
  }, {
    queued: { queued: true },
    undelivered: [{ messageId: "m-oat" }], // m1 reached the engine, so only the queued send is marked
    pending: [{ messageId: "m-oat", undelivered: true }],
  });
});

// ## A stop during an in-flight drain marks the drained inputs
//
// `drainSessionQueue` takes the inputs out of the queue before its send
// resolves. A stop in that time must still name them. The drain's start is
// made to fail after the stop, so the inputs go back to a queue the stop has
// already replaced; a second stop must not mark them again.
void test("a stop while a drain's send is in flight marks the drained inputs once", async (t) => {
  const { backend, session, send, has, undelivered } = await setup(t);
  await send("first message", "m1");
  await eventually(() => has("first message"), { label: "first delivered", timeoutMs: 120_000 });
  await send("add oat milk", "m-oat");
  await send("and eggs", "m-eggs");
  let stoppedInStart = false;
  backend.start = () => {
    stoppedInStart = true;
    session.stop();
    throw new Error("spawn EBADF");
  };
  // The run ends without a result, so its close handler drains the queue into a fresh run.
  session.restart();
  await eventually(() => stoppedInStart, { label: "drain reached the run start", timeoutMs: 60_000 });
  await session.whenStarted();
  session.stop();
  t.check({ undelivered: undelivered(), engineGotOat: has("add oat milk") }, {
    undelivered: [{ messageId: "m-oat" }, { messageId: "m-eggs" }], // once each, in queue order
    engineGotOat: false,
  });
});

// ## A drain whose inputs a stop took neither delivers nor requeues them
//
// The live-cap eviction (`registry/cap.ts`) stops a session and keeps it. Once
// `stop()` has marked a drain's inputs undelivered, that drain must not deliver
// them, now or on a later turn: the chat already offers to resend them.
void test("a drain whose inputs a stop took neither delivers nor requeues them", async (t) => {
  const { backend, session, send, has, undelivered } = await setup(t);
  await send("first message", "m1");
  await eventually(() => has("first message"), { label: "first delivered", timeoutMs: 120_000 });
  await send("add oat milk", "m-oat");
  // The turn result starts the drain synchronously after "done"; this microtask
  // runs before the drain's send gets past its first await, so the stop lands
  // while the send is in flight.
  session.once("done", () => { queueMicrotask(() => { session.stop(); }); });
  const first = backend.lastRun();
  if (first === null) throw new Error("no run");
  first.emitResult();
  await eventually(() => !session.isRunning() && !session.isBusy(), { label: "stopped run closed", timeoutMs: 60_000 });
  await session.whenStarted();

  // The next turn's result drains the queue: only what was queued since.
  await send("next message", "m-next");
  await eventually(() => has("next message"), { label: "next delivered", timeoutMs: 60_000 });
  backend.lastRun()?.emitResult();
  await send("last message", "m-last");
  await eventually(() => has("last message"), { label: "last delivered", timeoutMs: 60_000 });
  t.check({ undelivered: undelivered(), engineGotOat: has("add oat milk") }, {
    undelivered: [{ messageId: "m-oat" }],
    engineGotOat: false,
  });
});

// ## A stop during the drain's run start: not delivered, and marked
//
// Between admission and dispatch the drain awaits the turn's composition and
// the run start. A stop there takes the inputs; the run still comes up, and
// the drain must check again at dispatch rather than send what was marked.
void test("a stop while the drain's run is starting keeps the message from the engine", async (t) => {
  const { backend, session, send, has, undelivered } = await setup(t);
  await send("first message", "m1");
  await eventually(() => has("first message"), { label: "first delivered", timeoutMs: 120_000 });
  await send("add oat milk", "m-oat");
  const realStart = backend.start.bind(backend);
  let restarted = false;
  backend.start = (opts) => { restarted = true; session.stop(); return realStart(opts); };
  // The run ends without a result, so its close handler drains the queue into a fresh run.
  session.restart();
  await eventually(() => restarted, { label: "drain reached the run start", timeoutMs: 60_000 });
  await session.whenStarted();
  t.check({ undelivered: undelivered(), engineGotOat: has("add oat milk"), runs: backend.runs.length }, {
    undelivered: [{ messageId: "m-oat" }],
    engineGotOat: false,
    runs: 2, // the fresh run did start; only the send was withheld
  });
});

// ## A stop just after the drain's dispatch: delivered, and not marked
//
// Once the content is on the run, the engine has the message. A stop before
// the drain's send settles (it still releases its box work) must not call it
// undelivered.
void test("a stop right after the drain dispatched does not mark the message", async (t) => {
  const { backend, session, send, has, undelivered } = await setup(t);
  await send("first message", "m1");
  await eventually(() => has("first message"), { label: "first delivered", timeoutMs: 120_000 });
  await send("add oat milk", "m-oat");
  const realStart = backend.start.bind(backend);
  backend.start = (opts) => {
    const run = realStart(opts);
    const realSend = run.send.bind(run);
    run.send = (content, options) => { realSend(content, options); session.stop(); };
    return run;
  };
  session.restart();
  await eventually(() => has("add oat milk"), { label: "drain delivered", timeoutMs: 60_000 });
  await session.whenStarted();
  t.check({ undelivered: undelivered(), running: session.isRunning() }, { undelivered: [], running: false });
});

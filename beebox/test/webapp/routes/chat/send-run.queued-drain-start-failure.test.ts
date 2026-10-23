/**
 * A message queued behind a streaming turn is drained into a fresh run when
 * that run ends without a result. When the fresh run's start throws, the
 * queued input goes back to the queue and the session returns to ready; the
 * drain's error must not escape as an unhandled rejection, which ends the
 * box process on Node 24.
 */
import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, eventually } from "@ianbicking/tap-check/check";
import { makeTestServer } from "../../../helpers/test-route-server.js";
import { createFakeChatBackend, type FakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { getChatRuntime } from "../../../../src/webapp/chat-runtime.js";

function engineReceived(backend: FakeChatBackend): string[] {
  return backend.runs.flatMap((run) => run.sent.flatMap((blocks) => blocks.flatMap((b) => b.type === "text" ? [b.text] : [])));
}

async function setup(t: Test) {
  const unhandled: string[] = [];
  const onUnhandled = (reason: unknown): void => { unhandled.push(reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)); };
  // Replace tap's own handler for the duration so a rejection is recorded, not fatal to the runner.
  const prior = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", onUnhandled);
  t.teardown(() => { process.removeListener("unhandledRejection", onUnhandled); for (const l of prior) process.on("unhandledRejection", l); });

  const backend = createFakeChatBackend();
  const ctx = await makeTestServer({ chatBackend: backend });
  t.teardown(async () => { await ctx.cleanup(); });
  const runtime = getChatRuntime(ctx.boxRoot);
  if (runtime === undefined) throw new Error("no chat runtime");
  const resolved = await runtime.resolveSendTarget({ sessionParam: "new", contextDir: undefined, requestSeedFeatures: undefined, exactSession: false });
  if (!resolved.ok) throw new Error(resolved.error);
  const session = resolved.target.session;
  const send = (message: string, messageId: string) =>
    runtime.sendUserMessage({ target: resolved.target, message, messageId, user: null, channel: "ios-native" });
  const has = (text: string): boolean => engineReceived(backend).some((m) => m.includes(text));
  return { unhandled, backend, session, send, has };
}

void test("a queued message survives a drain whose run start throws", async (t) => {
  const { unhandled, backend, session, send, has } = await setup(t);

  await send("first message", "m1");
  await eventually(() => has("first message"), { label: "first delivered", timeoutMs: 120_000 });
  const second = await send("second message queued", "m2");
  backend.failNextStart = new Error("spawn EBADF");
  // The run ends without a result (as on a crash or the restart button), so the close handler drains the queue into a fresh run, whose start throws.
  session.restart();
  await eventually(() => backend.failNextStart === null, { label: "drain attempted a start", timeoutMs: 60_000 });
  await session.whenStarted();
  await new Promise((r) => setImmediate(r));
  // After the failed drain:
  t.check({
    second: second.body,
    runsAfterFailure: backend.runs.length,
    engineGotSecond: has("second message queued"),
    unhandled,
    busy: session.isBusy(),
  }, {
    second: { queued: true }, // the first turn was streaming
    runsAfterFailure: 1, // the failed start opened no run
    engineGotSecond: false, // no run took it
    unhandled: [], // the drain's error is logged, not thrown
    busy: false, // the session is back to idle, so the next send is admitted
  });

  // The next send is admitted and starts a run; its turn result drains the queued message into that run.
  const third = await send("third message", "m3");
  await eventually(() => has("third message"), { label: "third delivered", timeoutMs: 60_000 });
  const run = backend.lastRun();
  if (run === null) throw new Error("no run");
  run.emitResult();
  await eventually(() => has("second message queued"), { label: "queued message delivered", timeoutMs: 60_000 });
  t.check({ third: third.body, unhandled }, {
    third: { turnId: any(String) }, // admitted as its own turn, not queued or refused as busy
    unhandled: [],
  });
});

void test("two queued messages do not alternate drains while every start fails", async (t) => {
  const { unhandled, backend, session, send, has } = await setup(t);

  await send("first message", "m1");
  await eventually(() => has("first message"), { label: "first delivered", timeoutMs: 120_000 });
  await send("message A", "mA");
  // Every start fails while `failing` is set. The first failing start queues B, as a send that arrives while the drained start is in flight would.
  // The cap stops an unbounded loop so a regression fails the check instead of hanging the test.
  let failing = true;
  let failedStarts = 0;
  const realStart = backend.start.bind(backend);
  backend.start = (opts) => {
    if (!failing || failedStarts >= 10) return realStart(opts);
    failedStarts += 1;
    if (failedStarts === 1) session.enqueue({ text: "message B" });
    throw new Error("spawn EBADF");
  };
  session.restart();
  await eventually(() => failedStarts > 0, { label: "drain attempted a start", timeoutMs: 60_000 });
  // Let any follow-on drains run before counting.
  for (let i = 0; i < 20; i++) { await session.whenStarted(); await new Promise((r) => setImmediate(r)); }
  t.check({ failedStarts, runs: backend.runs.length, gotA: has("message A"), gotB: has("message B"), unhandled, busy: session.isBusy() }, {
    failedStarts: 1, // the failed drain does not drain again, so B is not tried and A is not retried
    runs: 1, // only the first turn's run opened
    gotA: false,
    gotB: false,
    unhandled: [],
    busy: false,
  });

  // Starts succeed again: the next send starts a run, and its turn result drains A and B together.
  failing = false;
  await send("third message", "m3");
  await eventually(() => has("third message"), { label: "third delivered", timeoutMs: 60_000 });
  const run = backend.lastRun();
  if (run === null) throw new Error("no run");
  run.emitResult();
  await eventually(() => has("message A") && has("message B"), { label: "A and B delivered", timeoutMs: 60_000 });
  t.check({ failedStarts, unhandled }, { failedStarts: 1, unhandled: [] });
});

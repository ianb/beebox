// # `POST /api/chat/send` — the claim is only as good as the record
//
// A `messageId` carries two claims, and they answer different questions. The
// **durable** claim (`.beebox/message-dedup.json`) is written at the same
// moment as the persisted user message, so `deduplicated: true` means "the box
// really has this message." The **volatile** claim lives only inside the running
// request — it stops a double-submit, but it proves nothing: if that request dies
// before its durable write, nothing was recorded.
//
// So a duplicate arriving while the first request is still in flight is never
// answered `deduplicated: true`. It waits for that request's real outcome and
// answers with it, the way the frontend's receipt expectations share one outcome
// for one id (`src/frontend/src/lib/receipts.ts`).
//
// On an idle chat the route records the message only once the session takes
// the turn, inside `chatSession.send()`: recording it earlier left a send the
// session then refused as busy in history and in the dedup map
// (`issues/closed/bugs/2026-10-14-busy-rejected-send-recorded-then-orphaned.md`). So a
// duplicate can arrive in that window, and the shared outcome answers it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { makeTestServer, TEST_SLUG } from "../../../helpers/test-route-server.js";
import { bodyField } from "../../../helpers/test-helpers.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { createInFlightSends } from "../../../../src/webapp/routes/chat/send-dedup.js";
import type { ChatBackend } from "../../../../src/services/claude-chat-types.js";
import { createEventBus, type BusEvent } from "../../../../src/core/event-bus/core.js";
import { createServer } from "../../../../src/webapp/server/app.js";
import { ChatSession } from "../../../../src/core/chat/session/run/core.js";

/**
 * Hold every `ChatSession.send()` open at its first instruction — the window in
 * which a request has claimed its id but recorded nothing. `entered` resolves
 * once a request is parked there, so a test can fire its duplicate knowing the
 * first request cannot advance until `release()`.
 */
interface SendGate {
  entered: Promise<void>;
  release: () => void;
  restore: () => void;
}

function openSendGate(): SendGate {
  const original = ChatSession.prototype.send;
  let markEntered = (): void => {};
  const entered = new Promise<void>((resolve) => { markEntered = () => resolve(); });
  let letGo = (): void => {};
  const held = new Promise<void>((resolve) => { letGo = () => resolve(); });
  ChatSession.prototype.send = async function patched(...args: Parameters<typeof original>) {
    markEntered();
    await held;
    return original.apply(this, args);
  };
  return {
    entered,
    release: () => letGo(),
    restore: () => { ChatSession.prototype.send = original; },
  };
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Resolves when the server first asks `backend` to start a run, whether that
 * start succeeds or throws. A send's run starts unawaited, behind a bootstrap
 * git commit; cleanup that deletes the box before then leaves the commit's
 * child holding the process open until the file times out (2026-10-10).
 */
function nextStart(backend: ChatBackend): Promise<void> {
  const realStart = backend.start.bind(backend);
  return new Promise<void>((resolve) => {
    backend.start = (opts) => { resolve(); return realStart(opts); };
  });
}

/** What survived to disk, or "(no file)" when nothing was ever persisted. */
async function readDedupState(boxRoot: string): Promise<string> {
  try {
    return await readFile(join(boxRoot, ".beebox", "message-dedup.json"), "utf-8");
  } catch (_e) {
    return "(no file)";
  }
}

interface RestartedBox {
  server: FastifyInstance;
  /** `chat-user-message` payloads this instance recorded. */
  recorded: string[];
  post: (payload: object) => Promise<{ statusCode: number; body: Record<string, unknown> }>;
  close: () => Promise<void>;
}

/**
 * A second server over the SAME box directory: a process restart. Nothing but
 * the box's own files crosses over — in particular the in-memory claims of the
 * previous instance are gone, which is exactly what a crash leaves behind.
 */
async function restartOver(boxRoot: string, chatBackend: ChatBackend): Promise<RestartedBox> {
  const eventBus = createEventBus(boxRoot, { pollInterval: 1000 });
  const server = await createServer({
    boxes: [{ slug: TEST_SLUG, boxRoot, eventBus }],
    openAccess: true,
    chatBackend,
  });
  const recorded: string[] = [];
  eventBus.subscribe({
    listener: (e: BusEvent) => { if (e.event === "chat-user-message") recorded.push(e.data.message); },
  });
  return {
    server,
    recorded,
    async post(payload: object) {
      const res = await server.inject({ method: "POST", url: `/${TEST_SLUG}/api/chat/send`, payload });
      return { statusCode: res.statusCode, body: res.json<Record<string, unknown>>() };
    },
    async close() {
      await server.close();
      eventBus.close();
    },
  };
}

// ## A duplicate in flight shares the first request's outcome
//
// The gate below parks the first request as it enters `chatSession.send()`,
// before the session takes the turn and so before anything is recorded. A
// duplicate fired then finds the volatile claim and waits. When the first request
// is admitted and answers, both clients get its one `{turnId}`, and the message
// is recorded once. The wait is short: the response does not wait for the
// engine to start (`docs/implemented-plans/emission-model.md`, Track A).
void test("The gate below parks the first request as it enters chatSession.send(), befor...", async (t) => {
  t.teardown(async () => {
    try {
      gate.restore();
      await started;
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const backend = createFakeChatBackend();
  const started = nextStart(backend);
  const ctx = await makeTestServer({ chatBackend: backend });

  const recorded: string[] = [];
  ctx.eventBus.subscribe({
    listener: (e: BusEvent) => { if (e.event === "chat-user-message") recorded.push(e.data.message); },
  });

  const gate = openSendGate();
  const send = () => ctx.request({
    method: "POST",
    url: "/api/chat/send",
    payload: { session: "new", message: "feed the cat", messageId: "dup-1" },
  });

  const first = send();
  await gate.entered;
  const second = send();
  await delay(50);
  gate.release();
  const [a, b] = await Promise.all([first, second]);

  t.check(`${a.statusCode} | ${b.statusCode} | turn=${typeof bodyField(a.body, "turnId")} | shared=${bodyField(b.body, "turnId") === bodyField(a.body, "turnId")} | recorded=${recorded.length}`, "200 | 200 | turn=string | shared=true | recorded=1");
});

// ## The shared-outcome path still holds the line if that window ever reopens
//
// The same rule pinned at the registry it lives in. A duplicate that finds a
// request in flight waits for that request's *real* outcome; it is never told
// `deduplicated: true`, because a request that has recorded nothing yet may
// still die or be refused.
void test("The same rule pinned at the registry it lives in.", async (t) => {
  const sends = createInFlightSends();
  const settle = sends.begin("in-flight-1");
  const waiting = sends.pending("in-flight-1");
  settle({ status: 200, body: { turnId: "t-1" } });

  await t.checkText(`${JSON.stringify(await waiting)} | afterSettle=${sends.pending("in-flight-1")}`, "{\"status\":200,\"body\":{\"turnId\":\"t-1\"}} | afterSettle=null");
});

// ## A send whose run fails to start is still accepted, for the duplicate too
//
// This section used to assert a shared **500**, and a freed id: the route awaited
// `chatSession.send()`, so a run that failed to start could still be reported as
// the HTTP outcome, and the id had to be released for the retry that invitation
// implied.
//
// It no longer can. The route records the message and answers `{turnId}` once
// the session takes the turn, before the run starts
// (`docs/implemented-plans/emission-model.md`, Track A), so by the time a spawn
// fails both clients have been told — truthfully — that the box has the message.
// The duplicate shares that `{turnId}`, and the later retry is answered
// `deduplicated: true`: the id stays claimed, because a redelivery must not
// append the message twice. The
// failure reaches the client on the turn stream it is already subscribed to —
// covered by `test/webapp/routes/chat/send-run.start-failure.test.ts`.
void test("This section used to assert a shared 500, and a freed id:", async (t) => {
  t.teardown(async () => {
    try {
      await started;
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const backend = createFakeChatBackend();
  const started = nextStart(backend);
  const ctx = await makeTestServer({ chatBackend: backend });

  const recorded: string[] = [];
  ctx.eventBus.subscribe({
    listener: (e: BusEvent) => { if (e.event === "chat-user-message") recorded.push(e.data.message); },
  });

  backend.failNextStart = new Error("spawn EBADF");
  const gate = openSendGate();
  const send = () => ctx.request({
    method: "POST",
    url: "/api/chat/send",
    payload: { session: "new", message: "water the plants", messageId: "dup-2" },
  });

  const first = send();
  await gate.entered;
  const second = send();
  await delay(50);
  gate.release();
  const [a, b] = await Promise.all([first, second]);
  gate.restore();

  const retry = await ctx.request({
    method: "POST",
    url: "/api/chat/send",
    payload: { session: "new", message: "water the plants", messageId: "dup-2" },
  });

  t.check(`${a.statusCode} | turn=${typeof bodyField(a.body, "turnId")} | shared=${bodyField(b.body, "turnId") === bodyField(a.body, "turnId")} | retry=${retry.statusCode} | dedup=${bodyField(retry.body, "deduplicated")} | recorded=${recorded.length}`, "200 | turn=string | shared=true | retry=200 | dedup=true | recorded=1");
});

// ## The claim and the record cross the restart together
//
// The persisted message event and the durable write are one synchronous span on
// both the busy and the idle path, so a crash can no longer land between them.
// That window used to be the whole engine spawn: the claim was
// persisted minutes before the message it stood for, and a crash inside it turned
// the client's retry into a false "already sent."
//
// What a restart can still see is a message whose run failed to start. Here the
// record and the claim are both on disk, so the retry is answered
// `deduplicated: true` by a process that never saw the original request — the
// right answer, because history really does have the message. (Its *delivery* was
// lost with the failed run; that is what the turn stream's error frame tells the
// client, and what Track A's failure-mode work covers.)
void test("The persisted message event and the durable write are one synchronous span on...", async (t) => {
  t.teardown(async () => {
    try {
      await restarted.close();
      await crashed.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const backend = createFakeChatBackend();
  backend.failNextStart = new Error("spawn EBADF");
  const started = nextStart(backend);
  const crashed = await makeTestServer({ chatBackend: backend });

  const failed = await crashed.request({
    method: "POST",
    url: "/api/chat/send",
    payload: { session: "new", message: "buy milk", messageId: "restart-1" },
  });
  const persisted = await readDedupState(crashed.boxRoot);

  // Crash once the run has failed to start, the state this section is about.
  await started;
  await crashed.server.close();
  const restarted = await restartOver(crashed.boxRoot, createFakeChatBackend());
  const retry = await restarted.post({ session: "new", message: "buy milk", messageId: "restart-1" });

  t.check(`${failed.statusCode} | turn=${typeof bodyField(failed.body, "turnId")} | persisted=${persisted.includes("restart-1")} | retry=${retry.statusCode} | dedup=${retry.body.deduplicated} | recorded=${restarted.recorded.length}`, "200 | turn=string | persisted=true | retry=200 | dedup=true | recorded=0");
});

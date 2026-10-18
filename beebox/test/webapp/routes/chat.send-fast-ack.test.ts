// # `POST /api/chat/send` — the ack is not coupled to the engine spawn
//
// The idle path acks the way the busy path always has: once the session admits
// the send, persist the user message and the message-id claim, answer, *then*
// start the run
// (`docs/implemented-plans/emission-model.md`, Track A). `{turnId}` means "the box durably has
// your message and this is where its output will appear", not "the engine
// started" — starting it can take minutes on a cold agent, and the client (plus
// every retry timer behind it) used to spend that whole window pending.

import { test } from "tap";
import "agent-doctest/tap";
import { makeTestServer } from "../../helpers/test-route-server.js";
import { bodyField } from "../../helpers/test-helpers.js";
import { createFakeChatBackend } from "../../../src/services/claude-chat/core.js";
import { getTurnBuffer } from "../../../src/core/chat/turn-buffer.js";
import { ChatSession } from "../../../src/core/chat/session/run/core.js";
import type { BusEvent } from "../../../src/core/event-bus/core.js";

/**
 * Hold every engine start (`ChatSession`'s private `startRun`) open — the
 * stand-in for a slow cold spawn. The send has already been admitted and its
 * message recorded by then, so the route acks while the start is parked here;
 * `entered` proves one is. Parking `send()` itself would hold the send before
 * admission, and the route waits for admission before it acks.
 */
interface SendGate {
  entered: Promise<void>;
  completed: Promise<void>;
  release: () => void;
  restore: () => void;
}

function openSendGate(): SendGate {
  const original: unknown = Reflect.get(ChatSession.prototype, "startRun");
  if (typeof original !== "function") throw new Error("ChatSession.startRun is gone; move this gate to the engine start");
  let markEntered = (): void => {};
  const entered = new Promise<void>((resolve) => { markEntered = () => resolve(); });
  let letGo = (): void => {};
  const held = new Promise<void>((resolve) => { letGo = () => resolve(); });
  let markCompleted = (): void => {};
  const completed = new Promise<void>((resolve) => { markCompleted = () => resolve(); });
  Reflect.set(ChatSession.prototype, "startRun", async function patched(this: ChatSession): Promise<unknown> {
    markEntered();
    await held;
    try {
      return await Reflect.apply(original, this, []);
    } finally {
      markCompleted();
    }
  });
  return {
    entered,
    completed,
    release: () => letGo(),
    restore: () => { Reflect.set(ChatSession.prototype, "startRun", original); },
  };
}

// ## The response arrives while the engine start is still parked
void test("The response arrives while the engine start is still parked", async (t) => {
  t.teardown(async () => {
    try {
      gate.restore();
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L63
  const backend = createFakeChatBackend();
  const ctx = await makeTestServer({ chatBackend: backend });

  // doctest:L66
  const recorded: string[] = [];
  ctx.eventBus.subscribe({
    listener: (e: BusEvent) => { if (e.event === "chat-user-message") recorded.push(e.data.message); },
  });

  // doctest:L71
  const gate = openSendGate();
  const res = await ctx.request({
    method: "POST",
    url: "/api/chat/send",
    payload: { session: "new", message: "how cold is it out", messageId: "ack-1" },
  });

  // doctest:L78
  t.check(
    // The engine start is still parked, so the backend has not been asked for a
    // run yet — and the client already has its turn.
    `${res.statusCode} | turn=${typeof bodyField(res.body, "turnId")} | recorded=${recorded.length} | runs=${backend.runs.length} | buffered=${getTurnBuffer(String(bodyField(res.body, "turnId"))) !== undefined}`,
    "200 | turn=string | recorded=1 | runs=0 | buffered=true",
  );

  // Releasing the gate lets the run start against the turn the client is already
  // subscribed to — no frame is lost, because the buffer was wired before the ack.

  // doctest:L88
  gate.release();
  await gate.completed;
  const started = backend.runs.length > 0;

  // doctest:L92
  t.check(`started=${started} | errored=${getTurnBuffer(String(bodyField(res.body, "turnId")))?.errored}`, "started=true | errored=null");
});

// ## A send that creates a new session acks just as fast
//
// Idle sends include ones with no session yet (`session: "new"` — the route's only
// way to ask for one; a request with no session at all is a 400) — the case the
// busy path never sees. The message is recorded while the session id is still
// unknown, so it is emitted as `null` and subscribers pick the id up on
// `session-assigned`; the pin and the turn buffer ride the pending session object
// and the server-minted `turnId` instead. The ack is the same, and it is just as
// early: the engine start below is still parked.
void test("Idle sends include ones with no session yet (session:", async (t) => {
  t.teardown(async () => {
    try {
      gate.release();
      await gate.completed;
      gate.restore();
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L112
  const backend = createFakeChatBackend();
  const ctx = await makeTestServer({ chatBackend: backend });

  // doctest:L115
  const recorded: string[] = [];
  const sessionIds: unknown[] = [];
  ctx.eventBus.subscribe({
    listener: (e: BusEvent) => {
      if (e.event !== "chat-user-message") return;
      recorded.push(e.data.message);
      sessionIds.push(e.data.sessionId);
    },
  });

  // doctest:L125
  const gate = openSendGate();
  const res = await ctx.request({
    method: "POST",
    url: "/api/chat/send",
    payload: { session: "new", message: "start something new", messageId: "ack-2" },
  });
  const live = getTurnBuffer(String(bodyField(res.body, "turnId")));

  // doctest:L133
  t.check(`${res.statusCode} | turn=${typeof bodyField(res.body, "turnId")} | recorded=${recorded.length} | sessionId=${JSON.stringify(sessionIds[0])} | runs=${backend.runs.length} | live=${live !== undefined && !live.complete}`, "200 | turn=string | recorded=1 | sessionId=null | runs=0 | live=true");
});

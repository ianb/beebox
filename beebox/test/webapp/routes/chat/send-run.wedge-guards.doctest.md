# `POST /api/chat/send` — the two ways an acked send could wedge, bounded

Acceptance is the durable record, not the engine spawn
(`docs/implemented-plans/emission-model.md`, Track A), which leaves two silent wedges to
close. Both are *silent* in the same way: the client keeps waiting and every
retry of its message id is answered from a claim nobody will ever settle.

1. `chatSession.send()` never resolves and never rejects — a run lock nobody
   released, a spawn that never returns. The turn buffer stays open, the
   session pin is never released, and the client streams a turn that will
   produce no frame.
2. Something between taking the volatile message-id claim and answering the
   request throws. Fastify reports the 500, but the in-flight claim outlives
   the request, so every later POST of that id parks on a promise that will
   never resolve.

```ts setup
import { ChatSession } from "../../../../src/core/chat/session/run/core.js";
import { createFakeChatBackend, type FakeChatBackendRun } from "../../../../src/services/claude-chat/core.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { makeTestServer } from "../../../helpers/doctest-server.js";
import { captureTurn, startAckedRun } from "../../../../src/webapp/routes/chat/send-run.js";
import { getTurnBuffer } from "../../../../src/core/chat/turn-buffer.js";
import type { BusEvent } from "../../../../src/core/event-bus/core.js";

/** The turn buffer once it has ended (finished or failed), awaiting its own
 *  change signal rather than polling against a deadline. */
async function awaitTurnEnd(turnId: string) {
  const buffer = getTurnBuffer(turnId);
  if (buffer === undefined) throw new Error(`no turn buffer for ${turnId}`);
  while (!buffer.complete) await buffer.waitForChange(undefined, buffer.versionSnapshot());
  return buffer;
}

/**
 * A request that hangs is a test failure, not a test that hangs. The wedge
 * this detects never settles, so the bound only has to sit inside the file's
 * 300s timeout to fail readably; it is not a latency budget. (At 3s the
 * healthy path missed it on a loaded host: 2026-10-07, a 73s block.)
 */
async function promptly(pending: Promise<{ statusCode: number }>): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<string>((resolve) => { timer = setTimeout(() => { resolve("HUNG"); }, 60_000); });
  return Promise.race([pending.then((res) => String(res.statusCode)), timeout]).finally(() => { clearTimeout(timer); });
}
```

## A `send()` that never settles fails the turn once the watchdog's bound passes

The bound is 10 minutes in production — a cold engine spawn legitimately takes
minutes, so this is the "something is wedged" backstop, not a latency budget.
The test shrinks it; nothing else changes.

```ts
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const session = new ChatSession(box.root, { backend, skipBootstrap: true });

let pinned = true;
const capture = captureTurn(session, { turnId: "wedged-turn", releasePin: () => { pinned = false; } });
startAckedRun({ send: () => new Promise<boolean>(() => { /* never settles */ }) }, {
  input: { text: "did you water the plants" },
  capture,
  watchdog: { timeoutMs: 40, periodMs: 5 },
});

const { errored, complete } = await awaitTurnEnd("wedged-turn");
`${errored} | pinned=${pinned} | complete=${complete}`
=> The run did not start within 40ms | pinned=false | complete=true
```

```ts cleanup
session.stop();
await box.cleanup();
```

## A send not yet admitted when the watchdog fires is refused, and records nothing

The route waits for the session to take the turn before it answers. If the
watchdog fires first, the request is answered as not admitted, and a late
admission is abandoned, so the message is not recorded after its client was
told it was refused.

```ts
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const session = new ChatSession(box.root, { backend, skipBootstrap: true });

let admitLate: (() => void) | undefined;
let recorded = 0;
const capture = captureTurn(session, { turnId: "late-turn", releasePin: () => undefined });
const answer = await startAckedRun({
  send: (_input, options) => { admitLate = options?.onAdmitted; return new Promise<boolean>(() => { /* still waiting on a lock */ }); },
}, {
  input: { text: "did you water the plants" },
  capture,
  onAdmitted: () => { recorded += 1; },
  watchdog: { timeoutMs: 40, periodMs: 5 },
});
let lateThrow = "none";
try { admitLate?.(); } catch (e) { lateThrow = (e as Error).message; }
({ answer, recorded, lateThrow })
=> { answer: { admitted: false, reason: "The run did not start within 40ms" }, recorded: 0, lateThrow: "Send abandoned before the session took the turn" }
```

```ts cleanup
session.stop();
await box.cleanup();
```

## A run that *did* start is never touched by the watchdog

The watchdog is cleared the moment `send()` settles either way, so a turn that
takes longer than the bound to produce its result is not failed out from under
the client.

```ts
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const session = new ChatSession(box.root, { backend, skipBootstrap: true });

const capture = captureTurn(session, { turnId: "live-turn", releasePin: () => undefined });
startAckedRun({ send: async () => true }, {
  input: { text: "water the plants" },
  capture,
  watchdog: { timeoutMs: 20, periodMs: 5 },
});

await new Promise((resolve) => { setTimeout(resolve, 120); });
`errored=${getTurnBuffer("live-turn")?.errored} | complete=${getTurnBuffer("live-turn")?.complete}`
=> errored=null | complete=false
```

```ts cleanup
session.stop();
await box.cleanup();
```

## A throw after the claim settles it with the 500, so retries still work

The event bus stands in for "anything between the claim and the ack" — its
`emit` is the first thing the accepted-message path calls.

```ts
const backend = createFakeChatBackend();
const realStart = backend.start.bind(backend);
const runStarted = new Promise<FakeChatBackendRun>((resolve) => {
  backend.start = (opts) => { const run = realStart(opts); resolve(run); return run; };
});
const ctx = await makeTestServer({ chatBackend: backend });

const recorded: string[] = [];
ctx.eventBus.subscribe({
  listener: (e: BusEvent) => { if (e.event === "chat-user-message") recorded.push(String(e.data.message)); },
});

const realEmit = ctx.eventBus.emit;
ctx.eventBus.emit = () => { throw new Error("bus wedged"); };

const failed = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: "new", message: "did you water the plants", messageId: "m1" },
});
failed.statusCode
=> 500
```

A second POST of the same id answers instead of parking on the dead claim —
without the settle it would wait for an outcome that never comes.

```ts continue
const duplicate = await promptly(ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: "new", message: "did you water the plants", messageId: "m1" },
}));
duplicate
=> 500
```

Nothing was recorded and no durable claim was taken, so once the bus recovers
the client's retry runs the message exactly once.

```ts continue
ctx.eventBus.emit = realEmit;
const retry = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: "new", message: "did you water the plants", messageId: "m1" },
});

`${retry.statusCode} | turn=${typeof retry.body.turnId} | recorded=${recorded.length} | ${recorded[0]}`
=> 200 | turn=string | recorded=1 | did you water the plants
```

The retried run reaches the backend and finishes once the backend answers.
Waiting for it also keeps cleanup from deleting the box under a run that is
still committing: on 2026-10-11 its bootstrap git commit outlived cleanup
and held the process open until the file timed out.

```ts continue
(await runStarted).emitResult();
const ended = await awaitTurnEnd(retry.body.turnId);
`errored=${ended.errored} | complete=${ended.complete}`
=> errored=null | complete=true
```

```ts cleanup
await ctx.cleanup();
```

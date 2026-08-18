# `POST /api/chat/send` — the ack is not coupled to the engine spawn

The idle path acks the way the busy path always has: persist the user message
and the message-id claim, answer, *then* start the run
(`docs/plans/emission-model.md`, Track A). `{turnId}` means "the box durably has
your message and this is where its output will appear", not "the engine
started" — starting it can take minutes on a cold agent, and the client (plus
every retry timer behind it) used to spend that whole window pending.

```ts setup
import { makeTestServer } from "../helpers/doctest-server.js";
import { createFakeChatBackend } from "../../src/services/claude-chat.js";
import { getTurnBuffer } from "../../src/core/chat/turn-buffer.js";
import { ChatSession } from "../../src/core/chat/session/index.js";
import type { BusEvent } from "../../src/core/event-bus.js";

/**
 * Hold every `ChatSession.send()` open at its first instruction — the stand-in
 * for a slow engine start. Nothing awaits the send any more, so the route runs
 * to completion while a send is parked here; `entered` proves one is.
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
  ChatSession.prototype.send = async function patched(message: Parameters<typeof original>[0]) {
    markEntered();
    await held;
    return original.call(this, message);
  };
  return {
    entered,
    release: () => letGo(),
    restore: () => { ChatSession.prototype.send = original; },
  };
}

/** Wait until the fake backend has opened its first run, or give up. */
async function awaitFirstRun(hasRun: () => boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    if (hasRun()) return true;
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
  return false;
}
```

## The response arrives while the engine start is still parked

```ts
const backend = createFakeChatBackend();
const ctx = await makeTestServer({ chatBackend: backend });

const recorded: string[] = [];
ctx.eventBus.subscribe({
  listener: (e: BusEvent) => { if (e.event === "chat-user-message") recorded.push(String(e.data.message)); },
});

const gate = openSendGate();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: "new", message: "how cold is it out", messageId: "ack-1" },
});

// The send is still held at its first instruction, so the backend has not been
// asked for a run yet — and the client already has its turn.
`${res.statusCode} | turn=${typeof res.body.turnId} | recorded=${recorded.length} | runs=${backend.runs.length} | buffered=${getTurnBuffer(String(res.body.turnId)) !== undefined}`
=> 200 | turn=string | recorded=1 | runs=0 | buffered=true
```

Releasing the gate lets the run start against the turn the client is already
subscribed to — no frame is lost, because the buffer was wired before the ack.

```ts continue
gate.release();
const started = await awaitFirstRun(() => backend.runs.length > 0);

`started=${started} | errored=${getTurnBuffer(String(res.body.turnId))?.errored}`
=> started=true | errored=null
```

```ts cleanup
gate.restore();
await ctx.cleanup();
```

## A send that creates a new session acks just as fast

Idle sends include ones with no session yet (`session: "new"` — the route's only
way to ask for one; a request with no session at all is a 400) — the case the
busy path never sees. The message is recorded while the session id is still
unknown, so it is emitted as `null` and subscribers pick the id up on
`session-assigned`; the pin and the turn buffer ride the pending session object
and the server-minted `turnId` instead. The ack is the same, and it is just as
early: the engine start below is still parked.

```ts
const backend = createFakeChatBackend();
const ctx = await makeTestServer({ chatBackend: backend });

const recorded: string[] = [];
const sessionIds: unknown[] = [];
ctx.eventBus.subscribe({
  listener: (e: BusEvent) => {
    if (e.event !== "chat-user-message") return;
    recorded.push(String(e.data.message));
    sessionIds.push(e.data.sessionId);
  },
});

const gate = openSendGate();
const res = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: "new", message: "start something new", messageId: "ack-2" },
});
const live = getTurnBuffer(String(res.body.turnId));

`${res.statusCode} | turn=${typeof res.body.turnId} | recorded=${recorded.length} | sessionId=${JSON.stringify(sessionIds[0])} | runs=${backend.runs.length} | live=${live !== undefined && !live.complete}`
=> 200 | turn=string | recorded=1 | sessionId=null | runs=0 | live=true
```

```ts cleanup
gate.release();
gate.restore();
await ctx.cleanup();
```

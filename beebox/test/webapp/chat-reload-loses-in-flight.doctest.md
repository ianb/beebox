# A reload cannot see the message the box just accepted

`POST /api/chat/send` answers 200 once the message is **durably recorded** — the
route says so itself: it emits the persisted `chat-user-message` onto the box's
event bus and takes the durable claim, and *"recording it IS acceptance"*
(`webapp/routes/chat-send-routes.ts`). Only after that does the engine start.

`chat.bootstrap` — what a page load runs — reads the session transcript and
nothing else (`core/chat/session/load-history.ts`). The transcript is written by
the agent subprocess, some time after the run begins.

Between those two facts is a window where the box has told the client it has the
message, has a durable record proving it, and would answer a reload by showing a
conversation that does not contain it. Live clients do not notice: they hold an
optimistic copy in memory and see the bus event over the WebSocket. A reload has
neither — a fresh page has no memory, and bootstrap never consults the bus.

This reproduces that window rather than fixing it, so the size and shape of the
gap are pinned before anything moves
(`issues/bugs/2026-08-09-reload-loses-in-flight-question.md`).

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTestServer } from "../helpers/doctest-server.js";
import { createFakeChatBackend } from "../../src/services/claude-chat.js";
import type { BusEvent } from "../../src/core/event-bus.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

function caller(server) {
  return appRouter.createCaller({
    boxRoot: server.boxRoot,
    boxSlug: "test",
    eventBus: server.eventBus,
    services: {},
    user: null,
    authed: true,
    isOwner: true,
  });
}

// What the chat page asks for on load.
const TAIL = { mode: "tail", tail: 200, minRealUserMessages: 2 };

async function readDedupState(boxRoot) {
  try {
    return await readFile(join(boxRoot, ".beebox", "message-dedup.json"), "utf-8");
  } catch (_e) {
    return "(no file)";
  }
}

function userText(entries) {
  return entries
    .filter((e) => e.type === "user")
    .map((e) => e.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
}
```

## The send is accepted and recorded; the reload sees nothing

The fake backend stands in for the agent subprocess. Like the real one it writes
no transcript of its own — the real subprocess writes one eventually, which is
precisely the lag being modelled here.

```ts
const ctx = await makeTestServer({ chatBackend: createFakeChatBackend() });

const recorded = [];
ctx.eventBus.subscribe({
  listener: (e: BusEvent) => { if (e.event === "chat-user-message") recorded.push(String(e.data.message)); },
});

const sent = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: "new", message: "<typed>where did I put the drawer key?</typed>", messageId: "m-1" },
});
print(`send accepted: ${sent.statusCode === 200}`);
print(`durably recorded on the bus: ${recorded.length === 1}`);
print(`the box has it: ${recorded[0]?.includes("drawer key") === true}`);
=>
send accepted: true
durably recorded on the bus: true
the box has it: true
```

Now the reload. `chat.bootstrap` is the whole of what a fresh page knows:

```ts continue
const boot = await caller(ctx).chat.bootstrap({ slice: TAIL });
JSON.stringify({ kind: boot.kind, entries: boot.history === null ? null : userText(boot.history.entries) })
=> {"kind":"empty","entries":null}
```

`kind: "empty"` with an empty history is still the honest answer about what is
**durable**, and that is what `history` means. What was missing is the other
record — so bootstrap now also reports what the box has *accepted*:

```ts continue
JSON.stringify({ pending: userText(boot.pending), uuid: boot.pending[0].uuid.startsWith("accepted-") })
=> {"pending":["<typed>where did I put the drawer key?</typed>"],"uuid":true}
```

`kind: "empty"` is the strongest form of the gap, and the one the field report
described. A message that opens a **new** chat is accepted before the engine has
assigned a session id, so there is not yet a session for the reload to resolve:
the page comes back to a blank chat — no history, no session, no sign the
message was ever sent — while `.beebox/message-dedup.json` on that same
box records the box having durably accepted it.

```ts continue
const dedup = await readDedupState(ctx.boxRoot);
dedup.includes("m-1")
=> true
```

The question is gone from the only thing a reloading client reads, while the box
holds a durable record of having accepted it. That is the bug, stated exactly:
not a lost message — a message that two readers disagree about.

**Window.** For an existing session the transcript lands within ~150 ms of the
subprocess writing each entry (`transcript-sync.ts` measures that lag), so the
gap is small though real. For a new session it lasts until the engine starts and
the id is recorded — a cold spawn is allowed ten minutes
(`chat-send-run.ts` `RUN_START_TIMEOUT_MS`), which is why the report came from a
reload during a turn that "appeared stuck". The earlier guess that the SDK
batches transcript writes until a turn ends is **wrong**: the batcher that does
that (`TranscriptMirrorBatcher`) only runs when the SDK's `sessionStore` option
is set, which this codebase never sets, and it mirrors to an external store
*after* the local write succeeds.

## An acceptance is not shown to a chat it does not belong to

A message accepted before the engine assigned an id carries no session, and the
first shape of this let such a row match *any* bootstrap — which would have put
a brand-new chat's unsent question inside whatever conversation happened to be
open. An id-less acceptance matches only an id-less bootstrap:

```ts continue
const elsewhere = await caller(ctx).chat.bootstrap({ session: "some-other-session", slice: TAIL });
JSON.stringify({ kind: elsewhere.kind, pending: elsewhere.pending.length })
=> {"kind":"unavailable","pending":0}
```

The send above carried no identity — an open box, nobody signed in — so there is
nobody to keep it from, and any reader of that box sees it:

```ts continue
function callerAs(server, email) {
  return appRouter.createCaller({
    boxRoot: server.boxRoot, boxSlug: "test", eventBus: server.eventBus,
    services: {}, user: { email, name: email }, authed: true, isOwner: false,
  });
}
const anyReader = await callerAs(ctx, "grace@example.com").chat.bootstrap({ slice: TAIL });
anyReader.pending.length
=> 1
```

A send that DOES name its sender is a different matter. An id-less row cannot be
told apart from another person's by session, so it is told apart by who sent it,
and it fails closed — a box where several people are each starting a chat does
not show them each other's unsent questions:

```ts continue
ctx.eventBus.emit("chat-user-message", {
  sessionId: null,
  message: "<typed user=\"Ada Lovelace\">is the loft key on the hook?</typed>",
  user: { email: "ada@example.com", name: "Ada Lovelace" },
  timestamp: new Date().toISOString(),
});

const asGrace = await callerAs(ctx, "grace@example.com").chat.bootstrap({ slice: TAIL });
const asAda = await callerAs(ctx, "ada@example.com").chat.bootstrap({ slice: TAIL });
JSON.stringify({
  grace: userText(asGrace.pending).some((t) => t.includes("loft key")),
  ada: userText(asAda.pending).some((t) => t.includes("loft key")),
})
=> {"grace":false,"ada":true}
```

```ts cleanup
await ctx.cleanup();
```
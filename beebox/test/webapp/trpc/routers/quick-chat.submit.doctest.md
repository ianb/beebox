# Quick chat submit, choose, discard, and home

`quickChat.submit` stores, routes, and delivers one thought in one request.
When the box is not sure where it goes, or cannot judge it at all, the thought
is stored as `needs-choice` and the person picks with `quickChat.choose`.
Nothing is lost when a step fails: the record holds the message, and a repeat
`submit` with the same id finishes the job (docs/plans/box-screen.md, track 1).

These doctests use a synthetic box, the fake Jev service, and a scripted chat
runtime. The runtime stands in for the send route's target resolution and its
sender: it claims each message id the way `send-dedup.ts` does, so a second
delivery of one id is answered as a duplicate.

```ts setup
import { mkdir, writeFile, rm, utimes } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { setChatRuntime, clearChatRuntime } from "../../../../src/webapp/chat-runtime.js";
import { quickChatRouter } from "../../../../src/webapp/trpc/routers/quick-chat.js";
import { createFakeJev } from "../../../../src/services/jev.js";
import { JevError } from "../../../../src/services/jev-wire.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { containedSessionCwd, getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";

const EVENT_BUS = { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} };
function caller(boxRoot, jev, options) {
  return quickChatRouter.createCaller({ boxRoot, boxSlug: "test", authed: options?.authed ?? true, services: { jev },
    user: { email: "ari@example.com", name: "Ari" }, eventBus: EVENT_BUS });
}

/**
 * A chat runtime scripted at the two seams quick chat uses. `resolve` answers
 * target resolution; `send` answers a send that claimed its id. Ids are claimed
 * on acceptance, as the durable claim is.
 */
function scriptedRuntime(boxRoot, script) {
  const log = { reservations: [], targets: [], sends: [] };
  const claimed = new Set();
  setChatRuntime(boxRoot, {
    registry: { reserve: async (input) => {
      log.reservations.push(input);
      const kind = script?.reserve ?? "reserved";
      return kind === "reserved" ? { kind, sessionId: input.sessionId } : { kind };
    } },
    resolveSendTarget: async (args) => {
      log.targets.push(args);
      return script?.resolve?.(args) ?? { ok: true, target: { session: {}, id: args.sessionParam === "new" ? null : args.sessionParam } };
    },
    sendUserMessage: async (args) => {
      log.sends.push({ message: args.message, user: args.user?.email ?? null, channel: args.channel ?? null });
      if (claimed.has(args.messageId)) return { status: 200, body: { deduplicated: true } };
      claimed.add(args.messageId);
      return script?.send?.(args) ?? { status: 200, body: { turnId: "turn-1" } };
    },
  });
  return log;
}

/** Run with console.warn and console.error captured: the degradations these examples cause are logged by design. */
async function capturingLogs(run) {
  const lines = [];
  const { warn, error } = console;
  console.warn = (...args) => { lines.push(`warn ${args.map(String).join(" ")}`); };
  console.error = (...args) => { lines.push(`error ${args.map(String).join(" ")}`); };
  try { return { result: await run(), lines }; }
  finally { console.warn = warn; console.error = error; }
}

async function failure(run) {
  try { await run(); return "unexpected success"; }
  catch (error) { return `${error.code}: ${error.message}`; }
}

/** A box with one resumable chat at the root and a Garden landmark. Candidates: c0 the chat, c1 a new chat in Garden, c2 a new general chat. */
async function gardenBox() {
  const box = await makeTmpBox();
    const sessionId = randomUUID();
  const log = getSessionLogPath(box.root, sessionId);
  await mkdir(dirname(log), { recursive: true });
  await writeFile(log, JSON.stringify({ type: "user", uuid: randomUUID(), timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "text", text: "Plan the week" }] } }) + "\n");
  await box.write(`_content/chat/web/2026-09-21_${sessionId}.chat.card`, `---\nsession: ${sessionId}\n---\n\n`);
  await box.write("_content/Garden/Garden.landmark.card", "---\nnavigation:\n  label: Garden\n---\n");
  return { box, sessionId };
}

function judged(probabilities) {
  return createFakeJev({ result: { model: "synthetic-jev", probabilities, confidence: Math.max(...Object.values(probabilities)) } });
}

/** A view without the parts every example repeats. */
function face(view) {
  const { id: _id, message: _message, createdAt: _createdAt, ...rest } = view;
  return rest;
}

const oldProjectsDir = process.env["BBX_CLAUDE_PROJECTS_DIR"];
```

```ts teardown
if (oldProjectsDir === undefined) delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
else process.env["BBX_CLAUDE_PROJECTS_DIR"] = oldProjectsDir;
```

## A clear thought posts at once

When the selected place holds at least 0.9 of the judgment, `submit` delivers
in the same request. The message goes through the sender framed as a typed
message with `source="box-screen"`, attributed to the caller, with the record id as its message id and the
caller's channel. The view names the chat; the probabilities stay on disk.

```ts
const { box, sessionId } = await gardenBox();
const runtime = scriptedRuntime(box.root);
const fake = judged({ c0: 0.95, c1: 0.03, c2: 0.02 });
const api = caller(box.root, fake);
const request = { id: randomUUID(), message: "Book the plumber for Tuesday", channel: "ios-native" };
const sent = await api.submit(request);
[face(sent), sent.destination.sessionId === sessionId, runtime.sends]
=> [
  { state: "sent", destination: { label: "“Plan the week”", sessionId: "«*»" } },
  true,
  [{ message: "<typed source=\"box-screen\">Book the plumber for Tuesday</typed>", user: "ari@example.com", channel: "ios-native" }],
]
```

A repeat of the same request, after a lost response, returns the stored record.
It does not ask Jev again or send again. Different text under the same id is
refused.

```ts continue
const again = await api.submit(request);
[again.state, fake.calls.length, runtime.sends.length]
=> ["sent", 1, 1]

await failure(() => api.submit({ ...request, message: "Something else" }))
=> CONFLICT: This send already has different text. Start another message.
```

Two callers submitting the same id at once take the record lock in turn: one
judgment, one delivery.

```ts continue
const twice = { id: randomUUID(), message: "Water the tomatoes" };
const [one, two] = await Promise.all([api.submit(twice), api.submit(twice)]);
[one.state, two.state, fake.calls.length, runtime.sends.length]
=> ["sent", "sent", 2, 2]
```

A busy chat queues the message; the view says so.

```ts continue
const busy = scriptedRuntime(box.root, { send: () => ({ status: 200, body: { queued: true } }) });
face(await api.submit({ id: randomUUID(), message: "Also the faucet" }))
=> { state: "sent", destination: { label: "“Plan the week”", sessionId: "«*»" }, queued: true }
```

```ts cleanup
clearChatRuntime(box.root);
await box.cleanup();
```

## An uncertain thought waits for the person

Below the floor, `submit` stores the thought and offers the three likeliest
destinations plus a new general chat. Nothing is sent. `choose` fixes one of
the offered destinations and delivers; a new chat is reserved first, so the
record names its session before delivery starts.

```ts
const { box } = await gardenBox();
const runtime = scriptedRuntime(box.root);
const api = caller(box.root, judged({ c0: 0.5, c1: 0.45, c2: 0.05 }));
const unsure = await api.submit({ id: randomUUID(), message: "What should I plant next to the tomatoes" });
[face(unsure), runtime.sends.length]
=> [
  {
    state: "needs-choice", reason: "uncertain",
    choices: [
      { candidateId: "c0", label: "“Plan the week”" },
      { candidateId: "c1", label: "New chat in Garden" },
      { candidateId: "c2", label: "New general chat" },
    ],
  },
  0,
]
```

A candidate the record did not offer is refused. The chosen one is delivered.
A second `choose` on the sent record returns it unchanged.

```ts continue
await failure(() => api.choose({ id: unsure.id, candidateId: "c9" }))
=> BAD_REQUEST: Choose one of the offered destinations.

const chosen = await api.choose({ id: unsure.id, candidateId: "c1", channel: "web-mobile" });
[face(chosen), chosen.destination.sessionId === runtime.reservations[0].sessionId, runtime.reservations[0].contextDir, runtime.sends.map((send) => send.channel)]
=> [{ state: "sent", destination: { label: "New chat in Garden", sessionId: "«uuid»" } }, true, "_content/Garden", ["web-mobile"]]

(await api.choose({ id: unsure.id, candidateId: "c0" })).destination.label
=> New chat in Garden

await failure(() => api.choose({ id: randomUUID(), candidateId: "c0" }))
=> NOT_FOUND: This message is no longer stored.
```

```ts cleanup
clearChatRuntime(box.root);
await box.cleanup();
```

## Voice and typed thoughts arrive as the person entered them

`origin` says how the thought was entered. A `voice` thought is delivered as
`<speech source="box-screen">`, a `typed` one as `<typed source="box-screen">`.
A client built before `origin` existed sends none, and its thought is typed.
The record keeps the origin, so a thought that waited for the person's choice
is delivered by `choose` in the same wrapper.

```ts
const { box } = await gardenBox();
const runtime = scriptedRuntime(box.root);
const sure = caller(box.root, judged({ c0: 0.95, c1: 0.03, c2: 0.02 }));
await sure.submit({ id: randomUUID(), message: "Call the plumber", origin: "voice" });
await sure.submit({ id: randomUUID(), message: "Buy stamps" });
const unsure = caller(box.root, judged({ c0: 0.5, c1: 0.45, c2: 0.05 }));
const waiting = await unsure.submit({ id: randomUUID(), message: "Something about the beds", origin: "voice" });
await unsure.choose({ id: waiting.id, candidateId: "c1" });
runtime.sends.map((send) => send.message)
=> [
  "<speech source=\"box-screen\">Call the plumber</speech>",
  "<typed source=\"box-screen\">Buy stamps</typed>",
  "<speech source=\"box-screen\">Something about the beds</speech>",
]
```

An origin outside the two is refused.

```ts continue
await failure(() => sure.submit({ id: randomUUID(), message: "Hum", origin: "video" }))
=> «BAD_REQUEST: *»
```

```ts cleanup
clearChatRuntime(box.root);
await box.cleanup();
```

## "New chat" is honored over the existing-chat preference

The box's existing root chat and the new general chat share the root. Jev
leans slightly to the new chat; the existing-chat preference sends the thought
to the existing chat. A thought that opens with "new chat" skips that
preference, and goes to a new chat.

```ts
const { box, sessionId } = await gardenBox();
const runtime = scriptedRuntime(box.root);
const api = caller(box.root, judged({ c0: 0.45, c1: 0.05, c2: 0.5 }));
const plain = await api.submit({ id: randomUUID(), message: "Plan the dinner" });
const fresh = await api.submit({ id: randomUUID(), message: "New chat: plan the dinner" });
[[plain.destination.label, plain.destination.sessionId === sessionId], [fresh.destination.label, fresh.destination.sessionId === runtime.reservations[0].sessionId]]
=> [["“Plan the week”", true], ["New general chat", true]]
```

```ts cleanup
clearChatRuntime(box.root);
await box.cleanup();
```

## Routing that cannot run still keeps the thought

With no OpenRouter key and no injected service, or when Jev fails or answers
badly, the thought is stored with `reason: "routing-unavailable"`. Its choices
are the recent chats and a new general chat, built without Jev.

```ts
const { box } = await gardenBox();
scriptedRuntime(box.root);
const reasons = [];
const { lines } = await capturingLogs(async () => {
  for (const jev of [undefined, createFakeJev({ error: new JevError("timeout", "request") }), createFakeJev({ error: new JevError("distribution keys did not match", "response") })]) {
    const view = await caller(box.root, jev).submit({ id: randomUUID(), message: "Remind me about the passport" });
    reasons.push(face(view));
  }
});
reasons
=> [
  { state: "needs-choice", reason: "routing-unavailable", choices: [{ candidateId: "c0", label: "“Plan the week”" }, { candidateId: "c2", label: "New general chat" }] },
  { state: "needs-choice", reason: "routing-unavailable", choices: [{ candidateId: "c0", label: "“Plan the week”" }, { candidateId: "c2", label: "New general chat" }] },
  { state: "needs-choice", reason: "routing-unavailable", choices: [{ candidateId: "c0", label: "“Plan the week”" }, { candidateId: "c2", label: "New general chat" }] },
]

lines
=> [
  "warn [quick-chat] routing judgment failed for «uuid»: Jev request error: timeout",
  "warn [quick-chat] routing judgment failed for «uuid»: Jev response error: distribution keys did not match",
]
```

When the catalog itself cannot be built, here an invalid rubric, the only
choice is a new general chat, and choosing it delivers.

```ts continue
await box.write("_config/chat-routing.yaml", "destinations: not-a-list\n");
const fake = judged({ c0: 1 });
const api = caller(box.root, fake);
const { result: stuck, lines: catalogLines } = await capturingLogs(() => api.submit({ id: randomUUID(), message: "Call the vet" }));
[face(stuck), fake.calls.length, catalogLines]
=> [
  { state: "needs-choice", reason: "routing-unavailable", choices: [{ candidateId: "general", label: "New general chat" }] },
  0,
  ["warn [quick-chat] routing catalog unavailable for «uuid»: Chat routing rubric is invalid. Check _config/chat-routing.yaml."],
]

face(await api.choose({ id: stuck.id, candidateId: "general" }))
=> { state: "sent", destination: { label: "New general chat", sessionId: "«uuid»" } }
```

```ts cleanup
clearChatRuntime(box.root);
await box.cleanup();
```

## A delivery that did not finish is finished by the next submit

If the server stops after writing `sending` and before delivering, the record
stays in `open/` with its destination fixed. Here the chat runtime is not
running at the first submit. `home` lists the record as unfinished, and a repeat
`submit` delivers it without asking Jev again.

```ts
const { box } = await gardenBox();
const fake = judged({ c0: 0.95, c1: 0.03, c2: 0.02 });
const api = caller(box.root, fake);
const request = { id: randomUUID(), message: "Renew the car registration" };
face(await api.submit(request))
=> { state: "sending", destination: { label: "“Plan the week”", sessionId: "«*»" }, lastError: "Chat is not running on the box. Retry in a moment." }

(await api.home()).open.map((view) => view.state)
=> ["sending"]

const runtime = scriptedRuntime(box.root);
[(await api.submit(request)).state, fake.calls.length, runtime.sends.length, (await api.home()).open.length]
=> ["sent", 1, 1, 0]
```

If the server stops after delivery and before writing `sent`, the second
delivery of the same message id is answered as a duplicate, with no outcome.
The record becomes `sent` with the destination it stored before delivery, and
without `queued`, which cannot be recovered. Here the first delivery claims the
id and then fails before answering.

```ts continue
const crashing = scriptedRuntime(box.root, { send: () => { throw new Error("server stopped"); } });
const lost = { id: randomUUID(), message: "Pay the water bill" };
const crash = await capturingLogs(() => api.submit(lost));
[face(crash.result), crash.lines]
=> [
  { state: "sending", destination: { label: "“Plan the week”", sessionId: "«*»" }, lastError: "server stopped" },
  ["error [quick-chat] delivery of «uuid» failed: Error: server stopped"],
]

face(await api.submit(lost))
=> { state: "sent", destination: { label: "“Plan the week”", sessionId: "«*»" } }

crashing.sends.length
=> 2
```

The message-id claim lasts seven days. Six days after the first delivery
attempt, a retry is refused without sending: the row says the message may
already be in the chat and offers only Open chat and Discard.

```ts continue
clearChatRuntime(box.root);
const late = { id: randomUUID(), message: "Book the dentist" };
await api.submit(late);
const lateRuntime = scriptedRuntime(box.root);
const realTime = process.env["BBX_TIME"];
process.env["BBX_TIME"] = new Date(Date.now() + 7 * 86_400_000).toISOString();
const refused = await api.submit(late);
if (realTime === undefined) delete process.env["BBX_TIME"]; else process.env["BBX_TIME"] = realTime;
[face(refused), lateRuntime.sends.length]
=> [{ state: "sending", destination: { label: "“Plan the week”", sessionId: "«*»" }, lastError: "This may already be in “Plan the week”. Open the chat to check.", expired: true }, 0]
```

```ts cleanup
clearChatRuntime(box.root);
await box.cleanup();
```

## A destination that is gone asks again

A chat deleted between routing and delivery answers the send route's named
410. The record goes back to `needs-choice` with `reason: "destination-gone"`,
and the gone chat is not offered again. A new chat whose landmark was removed
is gone the same way, before any reservation.

```ts
const { box } = await gardenBox();
const runtime = scriptedRuntime(box.root, { resolve: () => ({ ok: false, status: 410, error: "Conversation is not available on this machine", code: "CHAT_SESSION_UNAVAILABLE" }) });
const api = caller(box.root, judged({ c0: 0.95, c1: 0.03, c2: 0.02 }));
[face(await api.submit({ id: randomUUID(), message: "Order more mulch" })), runtime.sends.length]
=> [{ state: "needs-choice", reason: "destination-gone", choices: [{ candidateId: "c1", label: "New chat in Garden" }, { candidateId: "c2", label: "New general chat" }] }, 0]

scriptedRuntime(box.root);
const gardenApi = caller(box.root, judged({ c0: 0.02, c1: 0.95, c2: 0.03 }));
const pending = { id: randomUUID(), message: "Start a seed list" };
clearChatRuntime(box.root);
await gardenApi.submit(pending);
await rm(box.path("_content/Garden/Garden.landmark.card"));
const reservations = scriptedRuntime(box.root).reservations;
[face(await gardenApi.submit(pending)).reason, reservations.length]
=> ["destination-gone", 0]
```

```ts cleanup
clearChatRuntime(box.root);
await box.cleanup();
```

## A new chat on an engine without reservations has no session id yet

Codex assigns the session id when its first turn runs, so the record cannot
name it. (This box lists no Claude chats, so its candidates are a new chat in
Garden, `c0`, and a new general chat, `c1`.) The view names the destination without a session; the box screen
offers "All chats" instead of "Open chat".

```ts
const { box } = await gardenBox();
await box.write("_config/box.json", JSON.stringify({ agentEngine: "codex" }));
const runtime = scriptedRuntime(box.root, { reserve: "unsupported" });
const view = await caller(box.root, judged({ c0: 0.02, c1: 0.98 })).submit({ id: randomUUID(), message: "Start a reading list" });
[face(view), runtime.targets.map(({ sessionParam, exactSession, contextDir, engine }) => ({ sessionParam, exactSession, contextDir, engine }))]
=> [{ state: "sent", destination: { label: "New general chat" } }, [{ sessionParam: "new", exactSession: false, contextDir: "", engine: "codex" }]]
```

```ts cleanup
clearChatRuntime(box.root);
await box.cleanup();
```

## Discard ends a stored thought

A thought that was not sent can be discarded. It leaves the unfinished list. A
sent thought cannot be discarded and comes back unchanged.

```ts
const { box } = await gardenBox();
scriptedRuntime(box.root);
const api = caller(box.root, judged({ c0: 0.5, c1: 0.45, c2: 0.05 }));
const unsure = await api.submit({ id: randomUUID(), message: "Maybe repaint the fence" });
[(await api.home()).open.length, (await api.discard({ id: unsure.id })).state, (await api.home()).open.length]
=> [1, "discarded", 0]

const sent = await api.choose({ id: (await api.submit({ id: randomUUID(), message: "Fix the gate" })).id, candidateId: "c0" });
(await api.discard({ id: sent.id })).state
=> sent

await failure(() => api.discard({ id: randomUUID() }))
=> NOT_FOUND: This message is no longer stored.
```

```ts cleanup
clearChatRuntime(box.root);
await box.cleanup();
```

## Home: what the box screen shows

`home` lists unfinished thoughts, the ones sent in the last day, recent chats,
and the box's `nav.card` shortcuts. Recent chats are the chats whose directory
has a landmark, plus the last chat wherever it is: this box's only chat is at
the root, which has no landmark, so its row has a null landmark and the label
the Chats list gives it (an untitled chat's quoted opening). Shortcuts are box-relative; the routes the box screen already shows are
left out.

```ts
const { box, sessionId } = await gardenBox();
scriptedRuntime(box.root);
await box.write("nav.card", "---\nentries:\n  - { href: /questions }\n  - { href: /browse }\n  - { ref: /_content/Garden/Garden.landmark.card, label: Garden plan }\n---\n");
const api = caller(box.root, judged({ c0: 0.5, c1: 0.45, c2: 0.05 }));
await api.submit({ id: randomUUID(), message: "Unsure thought" });
await api.choose({ id: (await api.submit({ id: randomUUID(), message: "Sorted thought" })).id, candidateId: "c0" });
const home = await api.home();
const rootChats = home.recentChats.map((chat) => [chat.sessionId === sessionId, chat.label, chat.landmark]);
[home.open.map((view) => [view.message, view.state]), home.recentlySent.map((view) => [view.message, view.state]), rootChats, home.shortcuts]
=> [
  [["Unsure thought", "needs-choice"]],
  [["Sorted thought", "sent"]],
  [[true, "“Plan the week”", null]],
  [{ label: "Questions", to: "/questions" }, { label: "Garden plan", to: "/browse/_content/Garden/Garden.landmark.card" }],
]
```

Every procedure needs an authenticated caller.

```ts continue
const anonymous = caller(box.root, undefined, { authed: false });
[await failure(() => anonymous.home()), await failure(() => anonymous.submit({ id: randomUUID(), message: "x" })), await failure(() => anonymous.discard({ id: randomUUID() }))]
=> ["UNAUTHORIZED: Not authenticated", "UNAUTHORIZED: Not authenticated", "UNAUTHORIZED: Not authenticated"]
```

```ts cleanup
clearChatRuntime(box.root);
await box.cleanup();
```

## The last chat leads the recent chats, once

The recent chats are newest first. A last chat without a landmark leads the
landmark chats. When the last chat has a landmark it is already in the list,
and it appears once; a chat without a landmark that is not the last one is left
out, as the other recent-chat lists leave it out.

```ts
const { box, sessionId: rootChat } = await gardenBox();
scriptedRuntime(box.root);
const gardenChat = randomUUID();
const gardenLog = getSessionLogPath(containedSessionCwd(box.root, "_content/Garden"), gardenChat);
await mkdir(dirname(gardenLog), { recursive: true });
await writeFile(gardenLog, JSON.stringify({ type: "user", uuid: randomUUID(), timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "text", text: "Order seeds" }] } }) + "\n");
await box.write(`_content/chat/web/2026-09-22_${gardenChat}.chat.card`, `---\nsession: ${gardenChat}\ncontext-dir: _content/Garden\n---\n\n`);
const api = caller(box.root, judged({ c0: 1 }));
const rows = async () => (await api.home()).recentChats.map((chat) => [chat.sessionId === rootChat ? "root chat" : "garden chat", chat.landmark?.label ?? null]);

const earlier = new Date(Date.now() - 60_000);
await utimes(gardenLog, earlier, earlier);
await rows()
=> [["root chat", null], ["garden chat", "Garden"]]

const rootLog = getSessionLogPath(box.root, rootChat);
const earliest = new Date(Date.now() - 120_000);
await utimes(rootLog, earliest, earliest);
await rows()
=> [["garden chat", "Garden"]]
```

```ts cleanup
clearChatRuntime(box.root);
await box.cleanup();
```

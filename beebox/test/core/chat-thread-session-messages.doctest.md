# ChatThreadSession message handling

`ChatThreadSession` drives its SDK run through the **shared** adapter
(`adaptSdkMessage` in `src/core/chat/session/messages.ts`) — the same one
`ChatSession` uses. That adapter surfaces `user`, `stream_event`, and `task`
messages in addition to `system`/`assistant`/`result`. The thread path narrows
those away as **explicit flow control** in `handleMessage` (Track 6 convergence),
so this doctest proves the narrowing: a turn interleaving all of them still
extracts `<chat-response>` blocks cleanly, resolves the turn, and never lets a
`stream_event` partial or a `task` event leak into the accumulated turn text.

The thread backend does not enable `includePartialMessages` in production, so
`stream_event`s don't normally arrive — but the adapter *can* produce them, so
the thread path must handle them deterministically. We inject them here to lock
that behavior in.

```ts setup
import { ChatThreadSession } from "../../src/core/chat/session/thread.js";
import { createFakeChatBackend } from "../../src/services/claude-chat.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { waitForRuns } from "../helpers/chat-session-spawner-helpers.js";
import { recordSessionStart } from "../../src/core/chat/session/session-start-record.js";
```

## A turn interleaving user, stream_event, and task messages

The agent turn echoes the user message, streams partial deltas, emits an
assistant text block with a `<chat-response>`, starts a background task, streams
more, sends a second `<chat-response>`, then ends with `result`. Only the two
complete `<chat-response>` blocks are delivered, and the accumulated turn text
holds assistant output only.

```ts
const box = await makeTmpBox({ git: true });
const backend = createFakeChatBackend();
const session = new ChatThreadSession({
  boxRoot: box.root,
  threadRef: "chats/Jane_Doe.chat.card",
  chatDescription: "Jane Doe",
  backend,
});

const responses = [];
session.on("chat-response", (t) => responses.push(t));
let turnText = null;
session.on("turn-text", (t) => { turnText = t; });
const messageTypes = [];
session.on("message", (m) => messageTypes.push(m.type));

// send() resolves only when the turn completes, so capture the promise and
// drive the fake stream before awaiting it.
const turn = session.send("are we still on for tomorrow?");
await waitForRuns(backend, { count: 1, timeoutMs: 2000 });
const run = backend.lastRun();

run.emitSessionInit("sess-thread-1");
run.emitMessage({
  type: "user",
  session_id: "sess-thread-1",
  message: { role: "user", content: [{ type: "text", text: "are we still on for tomorrow?" }] },
  parent_tool_use_id: null,
});
run.emitMessage({
  type: "stream_event",
  session_id: "sess-thread-1",
  event: { type: "content_block_delta", delta: { type: "text_delta", text: "Che" } },
  parent_tool_use_id: null,
  uuid: "se-1",
});
run.emitAssistantText("<chat-response>Checking now</chat-response>looking at the calendar...");
run.emitMessage({
  type: "system",
  subtype: "task_started",
  session_id: "sess-thread-1",
  uuid: "task-1",
  task_id: "t-1",
  description: "reading calendar",
});
run.emitMessage({
  type: "stream_event",
  session_id: "sess-thread-1",
  event: { type: "content_block_delta", delta: { type: "text_delta", text: "Yes" } },
  parent_tool_use_id: null,
  uuid: "se-2",
});
run.emitAssistantText("<chat-response>Yes, 2pm still works</chat-response>");
run.emitResult();
await turn;

JSON.stringify(responses)
=> ["Checking now","Yes, 2pm still works"]
```

The accumulated turn text is the assistant output only — no `user` echo, no
`stream_event` partials, no `task` description bled in:

```ts continue
turnText
=> «*»<chat-response>Checking now</chat-response>looking at the calendar...<chat-response>Yes, 2pm still works</chat-response>
```

`stream_event` and `task` never reach the `message` listener; `user`, `system`,
`assistant`, and `result` do (forwarded for parity):

```ts continue
JSON.stringify(messageTypes)
=> ["system","user","assistant","assistant","result"]
```

The session id was captured from the first message that carried one:

```ts continue
session.getSessionId()
=> sess-thread-1
```

```ts cleanup
session.stop();
await box.cleanup();
```

## The turn resolves even when the only content is a task + stream_events

A turn that produces background-task activity and partial deltas but no
`<chat-response>` still resolves cleanly (the thread path doesn't wedge waiting
on assistant text): `send()` returns and `turn-text` fires with empty text.

```ts
const box = await makeTmpBox({ git: true });
const backend = createFakeChatBackend();
const session = new ChatThreadSession({
  boxRoot: box.root,
  threadRef: "chats/Bob_Smith.chat.card",
  chatDescription: "Bob Smith",
  backend,
});

const responses = [];
session.on("chat-response", (t) => responses.push(t));
let turnTextSeen = false;
let turnText = null;
session.on("turn-text", (t) => { turnTextSeen = true; turnText = t; });

const turn = session.send("just fyi");
await waitForRuns(backend, { count: 1, timeoutMs: 2000 });
const run = backend.lastRun();

run.emitSessionInit("sess-thread-2");
run.emitMessage({
  type: "system",
  subtype: "task_started",
  session_id: "sess-thread-2",
  uuid: "task-2",
  task_id: "t-2",
  description: "housekeeping",
});
run.emitMessage({
  type: "stream_event",
  session_id: "sess-thread-2",
  event: { type: "message_start" },
  parent_tool_use_id: null,
  uuid: "se-3",
});
run.emitResult();
await turn;

// The promise resolved (we got here) and turn-text fired with no responses.
JSON.stringify([turnTextSeen, turnText, responses.length])
=> [true,"",0]
```

```ts cleanup
session.stop();
await box.cleanup();
```

## A stored session id the box has no record of starts fresh

A thread carries its session id across restarts, and the id can outlive the
records that say what it is — the box's chat registry is machine-local state, and
a content revert can take the husk card with it. Resuming such an id asks
whichever engine the box currently defaults to to continue a conversation it
never had.

The thread drops the unrecorded id and starts a new session instead of failing.
It is automation: stranding the thread is worse than losing its earlier context,
and the SDK's first message supplies a new id, which the thread adopts and
emits on `session`.

```ts
const box = await makeTmpBox({ git: true });
const backend = createFakeChatBackend();
const session = new ChatThreadSession({
  boxRoot: box.root,
  threadRef: "chats/Jane_Doe.chat.card",
  chatDescription: "Jane Doe",
  sessionId: "99999999-9999-4999-8999-999999999999",
  backend,
});

const adopted = [];
session.on("session", (id) => adopted.push(id));

const turn = session.send("still there?");
await waitForRuns(backend, { count: 1, timeoutMs: 2000 });
const run = backend.lastRun();
print(`resumed: ${String(run.startOptions.resumeSessionId)}`);
print(`system prompt built: ${String(run.startOptions.systemPrompt.length > 0)}`);
=>
resumed: undefined
system prompt built: true
```

The id the SDK hands back is adopted, so the thread's owner relearns it:

```ts continue
run.emitSessionInit("sess-thread-fresh");
run.emitAssistantText("<chat-response>here</chat-response>");
run.emitResult();
await turn;
JSON.stringify(adopted)
=> ["sess-thread-fresh"]
```

```ts cleanup
session.stop();
await box.cleanup();
```

## A RECORDED session id is still resumed

The drop above is conditional on there being no record — the ordinary resume must
keep working, or every thread would lose its history on restart.

```ts
const box = await makeTmpBox({ git: true });
const backend = createFakeChatBackend();
const known = "88888888-8888-4888-8888-888888888888";
await recordSessionStart(box.root, { sessionId: known, engine: "claude" });

const session = new ChatThreadSession({
  boxRoot: box.root,
  threadRef: "chats/Jane_Doe.chat.card",
  chatDescription: "Jane Doe",
  sessionId: known,
  backend,
});

const turn = session.send("still there?");
await waitForRuns(backend, { count: 1, timeoutMs: 2000 });
const run = backend.lastRun();
print(`resumed: ${String(run.startOptions.resumeSessionId)}`);
=>
resumed: 88888888-8888-4888-8888-888888888888
```

```ts continue cleanup
run.emitAssistantText("<chat-response>here</chat-response>");
run.emitResult();
await turn;
session.stop();
await box.cleanup();
```

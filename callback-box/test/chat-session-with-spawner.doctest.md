# ChatSession with injected backend

`ChatSession` accepts a `ChatSessionOptions` bag that lets tests
inject a fake `ChatBackend` and override the system prompt, session
file, MCP config, env vars, and session-id callback. This doctest
exercises the full round-trip without spawning a real Claude
subprocess.

See `service-claude-chat.doctest.md` for the fake backend API.
Most of the helpers used below live in
`test/helpers/chat-session-spawner-helpers.ts` — the doctest loader
has trouble with top-level function declarations whose bodies return
inline object literals, so the helpers are in a regular `.ts` file.

```ts setup
import { ChatSession } from "../src/core/chat-session.js";
import { createFakeChatBackend } from "../src/services/claude-chat.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import {
  runTurn,
  tick,
  waitForRuns,
  setupSystemPrompt,
  testPrompt,
  testPromptShort,
  xPrompt,
  plainTestPrompt,
  buildSetupOpts,
  buildMainOpts,
  buildReopenSetupOpts,
  buildReopenMainOpts,
  SETUP_FILE,
} from "./helpers/chat-session-spawner-helpers.js";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
```

## Backend sees the right options

`ChatSession` builds system prompt + env + resume id + MCP config and
hands them to the backend. With an override prompt and extra env the
fake captures both:

```
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const opts = { backend, systemPrompt: testPrompt, extraEnv: { CB_ACTIVITY_NAME: "polyglot", CB_ACTIVITY_MODE: "setup" }, skipBootstrap: true };
const session = new ChatSession(box.root, opts);

await session.send("hello");
await tick();

const run = backend.lastRun();
run !== null && run.startOptions.systemPrompt
=> TEST PROMPT

run !== null && run.startOptions.env.CB_ACTIVITY_NAME
=> polyglot

run !== null && run.startOptions.env.CB_ACTIVITY_MODE
=> setup

run !== null && run.startOptions.resumeSessionId
=> undefined
```

```cleanup
session.stop();
await box.cleanup();
```

## Session ID gets assigned and persisted

When the fake emits the init system message with a `session_id`,
`ChatSession` persists it to `sessionFile` and calls the
`onSessionIdAssigned` callback. Subsequent runs reuse the id as
`resume`.

```
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const observed = [];
async function recordId(id) { observed.push(id); }
const opts = { backend, systemPrompt: testPromptShort, onSessionIdAssigned: recordId, skipBootstrap: true };
const session = new ChatSession(box.root, opts);

await session.send("first message");
await tick();

// Register the "done" waiter BEFORE emitting — the fake delivers
// synchronously, so emit/handle/"done" all fire before `once()` binds.
const done = once(session, "done");
const run = backend.lastRun();
run.emitSessionInit("sess-xyz");
run.emitAssistantText("hi back");
run.emitResult();
await done;

session.getSessionId()
=> sess-xyz

observed.join(",")
=> sess-xyz
```

A new ChatSession in the same box picks up the persisted id:

``` continue
const reloaded = new ChatSession(box.root, { backend, skipBootstrap: true });
reloaded.getSessionId()
=> sess-xyz
```

```cleanup
session.stop();
await box.cleanup();
```

## Custom sessionFile isolates activity sessions

Activity chat sessions store their session-id pointer inside the
instance dir, keyed by mode. A session with a custom `sessionFile`
writes its id to that file; a session pointed at a different
`sessionFile` sees a blank slate.

```
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const session = new ChatSession(box.root, buildSetupOpts(backend));
await runTurn(session, { backend, sessionIdToEmit: "sess-setup-1" });

const raw = await readFile(box.path(SETUP_FILE), "utf-8");
JSON.parse(raw).sessionId
=> sess-setup-1
```

Reopening with the same `sessionFile` recovers the saved id; a
different `sessionFile` has none:

``` continue
const reopen = new ChatSession(box.root, buildReopenSetupOpts(backend));
reopen.getSessionId()
=> sess-setup-1

const mainSession = new ChatSession(box.root, buildReopenMainOpts(backend));
mainSession.getSessionId()
=> null
```

```cleanup
session.stop();
await box.cleanup();
```

## MCP config flows through to the backend

When `mcpConfig` is provided, ChatSession passes it through to the
backend as the `cb-activity` MCP server. The SDK takes it directly
(no temp file needed).

```
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const mcp = { command: "tsx", args: ["mcp.ts"], env: { FOO: "bar" } };
const opts = { backend, systemPrompt: xPrompt, mcpConfig: mcp, skipBootstrap: true };
const session = new ChatSession(box.root, opts);

await session.send("hi");
await tick();

const run = backend.lastRun();
run.startOptions.mcpConfig.command
=> tsx

run.startOptions.mcpConfig.args[0]
=> mcp.ts

run.startOptions.mcpConfig.env.FOO
=> bar
```

```cleanup
session.stop();
await box.cleanup();
```

## End-to-end turn: send, receive, accumulate text

A full turn with an assistant text block + result event emits
`turn-text` on completion with the accumulated assistant text.

```
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const opts = { backend, systemPrompt: plainTestPrompt, skipBootstrap: true };
const session = new ChatSession(box.root, opts);

let turnText = null;
session.on("turn-text", (t) => { turnText = t; });

await session.send("what is 2+2?");
await tick();
const done = once(session, "done");
const run = backend.lastRun();
run.emitSessionInit("sess-123");
run.emitAssistantText("2+2 ");
run.emitAssistantText("equals 4.");
run.emitResult();
await done;

turnText
=> 2+2 equals 4.
```

And the backend received a user turn (one content array per send call):

``` continue
run.sent.length
=> 1

run.sent[0][0].type
=> text
```

```cleanup
session.stop();
await box.cleanup();
```

## Close handler drains queued messages into a fresh run

If the run ends while a turn is in progress and messages are queued
behind it, the close handler auto-drains the queue into a newly
started run. This recovers from wedged/killed sessions without losing
the user's in-flight messages.

```
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const opts = { backend, systemPrompt: plainTestPrompt, skipBootstrap: true };
const session = new ChatSession(box.root, opts);

// First message starts a turn; session goes busy
await session.send("first");
await tick();

// Two more messages queue up because busy=true
session.enqueue("second");
session.enqueue("third");

// Simulate the run ending mid-turn (no result emitted)
const run1 = backend.lastRun();
await run1.close();
await waitForRuns(backend, { count: 2, timeoutMs: 1000 });

// A second run got started and received the combined queued text
backend.runs.length
=> 2
```

``` continue
const run2 = backend.runs[1];
const userTurn = run2.sent[0];
const text = userTurn[0].text;
text.includes("second") && text.includes("third")
=> true
```

```cleanup
session.stop();
await box.cleanup();
```

## restart() closes the current run and drains queue into a fresh one

Calling `restart()` ends the current run; the close handler then
drains any queued messages into a new run, preserving the session
id. Unlike `stop()`, queued messages survive.

```
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const opts = { backend, systemPrompt: plainTestPrompt, skipBootstrap: true };
const session = new ChatSession(box.root, opts);

await session.send("hello");
await tick();
session.enqueue("queued after restart");

session.restart();
await waitForRuns(backend, { count: 2, timeoutMs: 1000 });

backend.runs.length
=> 2
```

``` continue
const run2 = backend.runs[1];
const userTurn = run2.sent[0];
userTurn[0].text.includes("queued after restart")
=> true
```

```cleanup
session.stop();
await box.cleanup();
```

## stop() clears queued messages — no auto-drain

`stop()` is used for intentional shutdown (including `resetSession`).
It clears the queue before closing the run so the close handler
doesn't surprise the caller by starting a new run.

```
const box = await makeTmpBox();
const backend = createFakeChatBackend();
const opts = { backend, systemPrompt: plainTestPrompt, skipBootstrap: true };
const session = new ChatSession(box.root, opts);

await session.send("hi");
await tick();
session.enqueue("will be discarded");

session.stop();
await tick();
await tick();

backend.runs.length
=> 1
```

```cleanup
await box.cleanup();
```

## Notes

- All the options are optional. `new ChatSession(boxRoot)` with no
  options still produces the pre-existing main-chat behavior.
- Inject the fake backend for any test that exercises
  send-to-response behavior. For tests that only care about session
  state (getSessionId, resetSession, getHistory), no backend is
  needed — those paths don't start a run.
- `tick()` lets the event loop drain after pushing messages into the
  fake. Use `once(session, "done")` to wait for a turn to complete.
- Avoid arrow-function expressions with `=>` on the same line as other
  code in example blocks — the doctest loader confuses the arrow with
  its expectation marker. Put lambdas in the setup block or a helper
  file.

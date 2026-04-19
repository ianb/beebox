# ChatSession with injected spawner

`ChatSession` accepts a `ChatSessionOptions` bag that lets tests
inject a fake `ClaudeChatSpawner` and override the system prompt,
session file, MCP config, env vars, and session-id callback. This
doctest exercises the full round-trip without spawning a real Claude
subprocess.

See `service-claude-chat.doctest.md` for the fake spawner API.
Most of the helpers used below live in
`test/helpers/chat-session-spawner-helpers.ts` — the doctest loader
has trouble with top-level function declarations whose bodies return
inline object literals, so the helpers are in a regular `.ts` file.

```ts setup
import { ChatSession } from "../src/core/chat-session.js";
import { createFakeClaudeChatSpawner } from "../src/services/claude-chat.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import {
  runTurn,
  tick,
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

## Spawner sees the right options

`ChatSession` builds system prompt + env + resume flag + MCP config
and hands them to the spawner. With an override prompt and extra env
the fake captures both:

```
const box = await makeTmpBox();
const spawner = createFakeClaudeChatSpawner();
const opts = { spawner, systemPrompt: testPrompt, extraEnv: { CB_ACTIVITY_NAME: "polyglot", CB_ACTIVITY_MODE: "setup" }, skipBootstrap: true };
const session = new ChatSession(box.root, opts);

await session.send("hello");
await tick();

const proc = spawner.lastProcess();
proc !== null && proc.spawnOptions.systemPrompt
=> TEST PROMPT

proc !== null && proc.spawnOptions.env.CB_ACTIVITY_NAME
=> polyglot

proc !== null && proc.spawnOptions.env.CB_ACTIVITY_MODE
=> setup

proc !== null && proc.spawnOptions.sessionIdToResume
=> undefined
```

```cleanup
session.stop();
await box.cleanup();
```

## Session ID gets assigned and persisted

When the fake emits the init system message with a `session_id`,
`ChatSession` persists it to `sessionFile` and calls the
`onSessionIdAssigned` callback. Subsequent turns reuse the id as
`--resume`.

```
const box = await makeTmpBox();
const spawner = createFakeClaudeChatSpawner();
const observed = [];
async function recordId(id) { observed.push(id); }
const opts = { spawner, systemPrompt: testPromptShort, onSessionIdAssigned: recordId, skipBootstrap: true };
const session = new ChatSession(box.root, opts);

await session.send("first message");
await tick();

// Register the "done" waiter BEFORE emitting — PassThrough may deliver
// synchronously, in which case emit/handle/"done" all fire before `once()` binds.
const done = once(session, "done");
const proc = spawner.lastProcess();
proc.emitSessionInit("sess-xyz");
proc.emitAssistantText("hi back");
proc.emitResult();
await done;

session.getSessionId()
=> sess-xyz

observed.join(",")
=> sess-xyz
```

A new ChatSession in the same box picks up the persisted id:

``` continue
const reloaded = new ChatSession(box.root, { spawner, skipBootstrap: true });
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
const spawner = createFakeClaudeChatSpawner();
const session = new ChatSession(box.root, buildSetupOpts(spawner));
await runTurn(session, { spawner, sessionIdToEmit: "sess-setup-1" });

const raw = await readFile(box.path(SETUP_FILE), "utf-8");
JSON.parse(raw).sessionId
=> sess-setup-1
```

Reopening with the same `sessionFile` recovers the saved id; a
different `sessionFile` has none:

``` continue
const reopen = new ChatSession(box.root, buildReopenSetupOpts(spawner));
reopen.getSessionId()
=> sess-setup-1

const mainSession = new ChatSession(box.root, buildReopenMainOpts(spawner));
mainSession.getSessionId()
=> null
```

```cleanup
session.stop();
await box.cleanup();
```

## MCP config gets written and passed

When `mcpConfig` is provided, ChatSession writes a temp JSON file with
the `mcpServers` wrapper claude expects, and passes the path via
`--mcp-config`. The spawner sees `mcpConfigPath` pointing at that file.

```
const box = await makeTmpBox();
const spawner = createFakeClaudeChatSpawner();
const mcp = { command: "tsx", args: ["mcp.ts"], env: { FOO: "bar" } };
const opts = { spawner, systemPrompt: xPrompt, mcpConfig: mcp, skipBootstrap: true };
const session = new ChatSession(box.root, opts);

await session.send("hi");
await tick();

const proc = spawner.lastProcess();
typeof proc.spawnOptions.mcpConfigPath
=> string
```

Read the temp config file back and check its shape:

``` continue
const raw = await readFile(proc.spawnOptions.mcpConfigPath, "utf-8");
const cfg = JSON.parse(raw);
cfg.mcpServers["cb-activity"].command
=> tsx

cfg.mcpServers["cb-activity"].env.FOO
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
const spawner = createFakeClaudeChatSpawner();
const opts = { spawner, systemPrompt: plainTestPrompt, skipBootstrap: true };
const session = new ChatSession(box.root, opts);

let turnText = null;
session.on("turn-text", (t) => { turnText = t; });

await session.send("what is 2+2?");
await tick();
const done = once(session, "done");
const proc = spawner.lastProcess();
proc.emitSessionInit("sess-123");
proc.emitAssistantText("2+2 ");
proc.emitAssistantText("equals 4.");
proc.emitResult();
await done;

turnText
=> 2+2 equals 4.
```

And stdin received a user-turn message:

``` continue
proc.sent.length >= 1
=> true

proc.sent[0].type
=> user
```

```cleanup
session.stop();
await box.cleanup();
```

## Notes

- All the options are optional. `new ChatSession(boxRoot)` with no
  options still produces the pre-existing main-chat behavior.
- Inject the fake spawner for any test that exercises
  spawn-to-response behavior. For tests that only care about session
  state (getSessionId, resetSession, getHistory), no spawner is needed
  — those paths don't start a subprocess.
- `tick()` lets the event loop drain after pushing lines onto the
  fake's stdout. Use `once(session, "done")` to wait for a turn to
  complete.
- Avoid arrow-function expressions with `=>` on the same line as other
  code in example blocks — the doctest loader confuses the arrow with
  its expectation marker. Put lambdas in the setup block or a helper
  file.

# ClaudeChatSpawner service

`ClaudeChatSpawner.spawn(opts)` returns a ChildProcess-like handle with
`stdin` / `stdout` / `stderr` streams. The real implementation shells
out to `cb-claude`; the fake returns PassThrough streams plus a
test-facing API for scripting the stream-json protocol.

Use the fake to test anything that drives a chat session — no
subprocess, no network, fully deterministic.

```ts setup
import { createFakeClaudeChatSpawner } from "../src/services/claude-chat.js";
import * as readline from "node:readline";
```

## Spawning and inspecting options

Every `spawn` call records its options on the returned process handle,
so tests can assert what would have been passed to claude:

```
const spawner = createFakeClaudeChatSpawner();
const proc = spawner.spawn({
  cwd: "/tmp/box",
  systemPrompt: "You are a greeter",
  sessionIdToResume: "sess-abc",
  env: { FOO: "bar" },
});
proc.spawnOptions.systemPrompt
=> You are a greeter

proc.spawnOptions.sessionIdToResume
=> sess-abc

proc.spawnOptions.env.FOO
=> bar

proc.spawnOptions.cwd
=> /tmp/box

spawner.processes.length
=> 1

spawner.lastProcess() === proc
=> true
```

## Emitting stream-json messages

Tests push lines onto the fake's `stdout` as if claude emitted them.
Callers (like `ChatSession`) read that stdout with `readline` and
dispatch messages.

```
const spawner = createFakeClaudeChatSpawner();
const proc = spawner.spawn({ cwd: "/tmp", systemPrompt: "x", env: {} });

const received = [];
const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
rl.on("line", (line) => received.push(JSON.parse(line)));

proc.emitSessionInit("sess-xyz");
proc.emitAssistantText("Hello there");
proc.emitResult();

// Give the event loop a tick to flush
await new Promise((r) => setImmediate(r));

received.length
=> 3

received[0].type
=> system

received[0].session_id
=> sess-xyz

received[1].type
=> assistant

received[1].message.content[0].text
=> Hello there

received[2].type
=> result
```

## Capturing stdin

Anything written to `proc.stdin` is JSON-parsed and pushed onto
`proc.sent`. Tests use this to assert that the caller sent the right
user turns.

```
const spawner = createFakeClaudeChatSpawner();
const proc = spawner.spawn({ cwd: "/tmp", systemPrompt: "x", env: {} });

proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }) + "\n");
proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: "bye" } }) + "\n");
await new Promise((r) => setImmediate(r));

proc.sent.length
=> 2

proc.sent[0].message.content
=> hi

proc.sent[1].message.content
=> bye
```

## Lifecycle: close and kill

Both `close()` and `kill()` fire the `"close"` event, which
`ChatSession` listens on to detect the subprocess exiting. The close
callback receives the exit code.

```
const spawner = createFakeClaudeChatSpawner();
const proc = spawner.spawn({ cwd: "/tmp", systemPrompt: "x", env: {} });

let closedWith = undefined;
proc.on("close", (code) => { closedWith = code; });
proc.close(0);
await new Promise((r) => setImmediate(r));

closedWith
=> 0
```

```
const spawner = createFakeClaudeChatSpawner();
const proc = spawner.spawn({ cwd: "/tmp", systemPrompt: "x", env: {} });

let closedWith = "unset";
proc.on("close", (code) => { closedWith = code; });
proc.kill();
await new Promise((r) => setImmediate(r));

closedWith
=> null
```

## Notes for agents writing chat-adjacent code

- Any code that spawns claude for a chat session should accept a
  `ClaudeChatSpawner` via constructor/options so tests can swap in the
  fake. See `ChatSession` for the pattern.
- The fake's `spawnOptions` is the source of truth for assertions
  about arguments — there's no need to reconstruct the argv string.
- Use `readline.createInterface({ input: proc.stdout })` to consume
  messages, matching the real implementation. Tests can assert on
  parsed objects instead of raw lines.
- Schedule your `emitMessage` calls before asserting — since streams
  deliver data asynchronously, insert a `await new Promise((r) =>
  setImmediate(r))` to let the event loop flush.

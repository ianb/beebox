# ChatBackend service

`ChatBackend.start(opts)` returns a `ChatBackendRun` — a handle on a
long-lived `query()` call against `@anthropic-ai/claude-agent-sdk`.
The run lets you push user content, iterate SDK messages, interrupt a
turn, or close the conversation. The real implementation calls the
SDK; the fake gives tests a scriptable handle for deterministic
unit-testing without spawning a Claude subprocess.

Use the fake to test anything that drives a chat session — no
subprocess, no network, fully deterministic.

```ts setup
import { createFakeChatBackend } from "../src/services/claude-chat.js";
```

## Starting a run and inspecting options

Every `start()` call records its options on the returned run, so
tests can assert what would have been passed to the SDK:

```ts
const backend = createFakeChatBackend();
const run = backend.start({
  cwd: "/tmp/box",
  systemPrompt: "You are a greeter",
  resumeSessionId: "sess-abc",
  env: { FOO: "bar" },
});
run.startOptions.systemPrompt
=> You are a greeter

run.startOptions.resumeSessionId
=> sess-abc

run.startOptions.env.FOO
=> bar

run.startOptions.cwd
=> /tmp/box

backend.runs.length
=> 1

backend.lastRun() === run
=> true
```

## Emitting SDK messages

Tests push SDK messages onto the run's `messages` iterable via the
`emit*` helpers. Callers (like `ChatSession`) consume the iterable.

```ts
const backend = createFakeChatBackend();
const run = backend.start({ cwd: "/tmp", systemPrompt: "x", env: {} });

const received = [];
const consume = (async () => {
  for await (const msg of run.messages) {
    received.push(msg);
  }
})();

run.emitSessionInit("sess-xyz");
run.emitAssistantText("Hello there");
run.emitResult();
await run.close();
await consume;

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

## Capturing send() calls

Each `send(content)` call appends to `run.sent` — the test asserts
on what content blocks the caller pushed.

```ts
const backend = createFakeChatBackend();
const run = backend.start({ cwd: "/tmp", systemPrompt: "x", env: {} });

run.send([{ type: "text", text: "hi" }]);
run.send([{ type: "text", text: "bye" }]);

run.sent.length
=> 2

run.sent[0][0].text
=> hi

run.sent[1][0].text
=> bye
```

## Lifecycle: close and interrupt

`close()` ends the messages iterable so the consumer's for-await loop
returns. `interrupt()` is a no-op on the fake other than flipping
`interrupted`; production tests typically just observe whether
`ChatSession.interrupt()` reached the backend.

```ts
const backend = createFakeChatBackend();
const run = backend.start({ cwd: "/tmp", systemPrompt: "x", env: {} });

let ended = false;
const consume = (async () => {
  for await (const _ of run.messages) { /* drain */ }
  ended = true;
})();

await run.close();
await consume;

ended
=> true

run.closed
=> true
```

```ts
const backend = createFakeChatBackend();
const run = backend.start({ cwd: "/tmp", systemPrompt: "x", env: {} });

await run.interrupt();
run.interrupted
=> true
```

## Notes for agents writing chat-adjacent code

- Any code that drives a chat session should accept a
  `ChatBackend` via constructor/options so tests can swap in the
  fake. See `ChatSession` for the pattern.
- `run.startOptions` is the source of truth for assertions about
  arguments — there's no need to reconstruct an argv string.
- Iterate `run.messages` with `for await ... of` to consume the
  stream. The iterable returns when the run is closed.
- The fake's `emit*` helpers deliver synchronously; assertions don't
  usually need to wait for ticks. When working through `ChatSession`
  (which has an internal async loop) you may still need a
  `setImmediate` tick to flush queued event handlers.

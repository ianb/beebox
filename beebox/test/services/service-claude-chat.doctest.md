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
import { buildQueryOptions, createFakeChatBackend, warmSlotKey, warmCompatible } from "../../src/services/claude-chat.js";
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

The real Claude adapter forwards the exact BBX environment supplied by the
session starter to the SDK query options.

```ts
const exactEnv = {
  PATH: "/repo/beebox/bin:/usr/bin",
  BBX_SERVER_URL: "http://127.0.0.1:3210",
  BBX_AGENT_TOKEN: "agent-token",
};
const built = buildQueryOptions({
  cwd: "/tmp/box",
  systemPrompt: "system",
  resumeSessionId: "sess-abc",
  env: exactEnv,
});
JSON.stringify(built.queryOptions.env)
=> {"PATH":"/repo/beebox/bin:/usr/bin","BBX_SERVER_URL":"http://127.0.0.1:3210","BBX_AGENT_TOKEN":"agent-token"}
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

## Warm pool: prewarm, hasWarm, closeWarm

The backend can hold a single pre-warmed subprocess so the next compatible
`start()` skips spawn latency. The fake models that slot with observable
counters and a `describe()` snapshot — no real subprocess. `prewarm()` installs
the slot, `hasWarm()` reports whether one is held or warming, and `closeWarm()`
reaps it (idle registries call this on the sweep).

```ts
const backend = createFakeChatBackend();
const start = backend.describe();

await backend.prewarm({ cwd: "/tmp", systemPrompt: "x", env: {} });
const afterWarm = backend.describe();

backend.closeWarm();
const afterClose = backend.describe();

[start, "--", afterWarm, "--", afterClose].join("\n")
=> warmHeld: false
warming: false
prewarmCount: 0
closeWarmCount: 0
--
warmHeld: true
warming: false
prewarmCount: 1
closeWarmCount: 0
--
warmHeld: false
warming: false
prewarmCount: 1
closeWarmCount: 1
```

`hasWarm()` gates re-prewarm stampedes — true once warmed, false after a reap:

```ts
const backend = createFakeChatBackend();
backend.hasWarm()
=> false

await backend.prewarm({ cwd: "/tmp", systemPrompt: "x", env: {} });
backend.hasWarm()
=> true

backend.closeWarm();
backend.hasWarm()
=> false
```

### closeWarm abandons an in-flight warm-up

The real backend re-warms with an async `startup()`; a `closeWarm()` while that
is in flight must NOT install the resulting slot — it's closed the moment it
lands (an epoch check). With `autoSettleWarm` off, the fake holds warm-ups in
flight so this path is testable: `hasWarm()` is true while warming, but a
`closeWarm()` before `settleWarm()` abandons the slot so nothing is installed.

```ts
const backend = createFakeChatBackend();
backend.autoSettleWarm = false;

await backend.prewarm({ cwd: "/tmp", systemPrompt: "x", env: {} });
// Warm-up in flight: hasWarm true, but no slot held yet.
const warming = backend.describe();

// Reap arrives mid-warm, then the warm-up settles.
backend.closeWarm();
const installed = backend.settleWarm();
const settled = backend.describe();

[warming, "--", `installed=${installed}`, "--", settled].join("\n")
=> warmHeld: false
warming: true
prewarmCount: 1
closeWarmCount: 0
--
installed=false
--
warmHeld: false
warming: false
prewarmCount: 1
closeWarmCount: 1
```

Without an interleaved `closeWarm()`, the same in-flight warm-up settles into a
held slot:

```ts
const backend = createFakeChatBackend();
backend.autoSettleWarm = false;

await backend.prewarm({ cwd: "/tmp", systemPrompt: "x", env: {} });
const installed = backend.settleWarm();

`installed=${installed} hasWarm=${backend.hasWarm()}`
=> installed=true hasWarm=true
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

## A warm subprocess only ever serves the chat it was warmed for

A warm slot has its session id baked in at spawn (`--session-id`), so the pool
is keyed by chat. The unkeyed slot — `""` — is the speculative one, for a send
that brings no id of its own.

```ts
const base = { cwd: "/tmp", systemPrompt: "x", env: {} };
const forChatA = { ...base, coinedSessionId: "aaaaaaaa-1111-4111-8111-111111111111" };
const forChatB = { ...base, coinedSessionId: "bbbbbbbb-2222-4222-8222-222222222222" };

JSON.stringify({ speculative: warmSlotKey(base), chatA: warmSlotKey(forChatA) })
=> {"speculative":"","chatA":"aaaaaaaa-1111-4111-8111-111111111111"}
```

A slot warmed for one chat is refused for another, and the speculative slot is
refused for a chat that brought its own id — it would start the conversation
under the wrong one:

```ts continue
JSON.stringify({
  sameChat: warmCompatible(forChatA, forChatA),
  otherChat: warmCompatible(forChatA, forChatB),
  speculativeForCoined: warmCompatible(base, forChatA),
  coinedForSpeculative: warmCompatible(forChatA, base),
})
=> {"sameChat":true,"otherChat":false,"speculativeForCoined":false,"coinedForSpeculative":false}
```

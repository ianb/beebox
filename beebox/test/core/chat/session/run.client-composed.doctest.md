# Turns built from text the user did not type

Claude Code treats prompt text as something a person typed: it can turn
`@path` mentions into file attachments and dispatch a leading `/` as a
command. Text that comes from somewhere else (another Telegram participant, a
script's self-note, a fired schedule, card content inlined into an agent run)
must not get that treatment. The SDK's `client_composed` marks one streamed
message that way; `verbatimPrompts` marks every message of a query.

Chat marks per turn, because the boxholder's own typed turns still rely on
slash commands (`/compact`). Agent runs send one beebox-composed prompt per
query, so they mark the whole query.

```ts setup
import { ChatSession } from "../../../../src/core/chat/session/run/core.js";
import { ChatThreadSession } from "../../../../src/core/chat/session/thread.js";
import { combineQueuedInputs } from "../../../../src/core/chat/session/state.js";
import { buildQueryOptions } from "../../../../src/core/agent/invoke/run.js";
import { createFakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { once } from "node:events";
import { waitForRuns, plainTestPrompt } from "../../../helpers/chat-session-spawner-helpers.js";
```

## A composed send marks the turn; a typed send does not

```ts
const box = await makeTmpBox({ git: true });
const backend = createFakeChatBackend();
const session = new ChatSession(box.root, { backend, systemPrompt: plainTestPrompt, skipBootstrap: true });

await session.send({ text: "<typed>hello</typed>" });
await waitForRuns(backend, { count: 1, timeoutMs: 2000 });
const run = backend.lastRun();
const done = once(session, "done");
run.emitSessionInit("sess-cc");
run.emitResult();
await done;
await session.send({ text: "<self-note>from a script</self-note>", clientComposed: true });

JSON.stringify(run.sentClientComposed)
=> [false,true]
```

```ts cleanup
session.stop();
await box.cleanup();
```

## Queued sends: one composed input marks the combined turn

Sends that arrive during a busy turn are joined into one turn. The combined
turn is composed if any part of it is, so outside text cannot ride along
unmarked with a typed message.

```ts
JSON.stringify([
  combineQueuedInputs([{ text: "typed" }, { text: "note", clientComposed: true }]).clientComposed,
  combineQueuedInputs([{ text: "typed" }, { text: "more typed" }]).clientComposed,
])
=> [true,null]
```

(`null` is how `JSON.stringify` prints a missing entry in an array.)

## Telegram thread sessions mark every turn

A thread session's input is other chat participants' messages, so every
turn is composed.

```ts
const box = await makeTmpBox({ git: true });
const backend = createFakeChatBackend();
const session = new ChatThreadSession({
  boxRoot: box.root,
  threadRef: "chats/Jane_Doe.chat.card",
  chatDescription: "Jane Doe",
  backend,
});
const turn = session.send('<chat-message from="Jane">hi</chat-message>');
await waitForRuns(backend, { count: 1, timeoutMs: 2000 });
const run = backend.lastRun();
run.emitSessionInit("sess-thread-cc");
run.emitResult();
await turn;

JSON.stringify(run.sentClientComposed)
=> [true]
```

```ts cleanup
await box.cleanup();
```

## Agent runs mark the whole query

```ts
const options = buildQueryOptions(
  { boxRoot: "/box", systemPrompt: "", prompt: "hi" },
  { env: {}, maxTurns: 4, binaryPath: null, appendedSystem: "" },
);
options.verbatimPrompts
=> true
```

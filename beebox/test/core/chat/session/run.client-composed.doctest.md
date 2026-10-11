# Turns built from text the user did not type

Claude Code treats prompt text as something a person typed: it can turn
`@path` mentions into file attachments and dispatch a leading `/` as a
command. Text that comes from somewhere else (another participant's message, a
script's self-note, a fired schedule, card content inlined into an agent run)
must not get that treatment. The SDK's `client_composed` marks one streamed
message that way; `verbatimPrompts` marks every message of a query.

Chat marks per turn, because the boxholder's own typed turns still rely on
slash commands (`/compact`). Agent runs send one beebox-composed prompt per
query, so they mark the whole query.

```ts setup
import { ChatSession } from "../../../../src/core/chat/session/run/core.js";
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

## Agent runs mark the whole query

```ts
const options = buildQueryOptions(
  { boxRoot: "/box", systemPrompt: "", prompt: "hi" },
  { env: {}, maxTurns: 4, binaryPath: null, appendedSystem: "" },
);
options.verbatimPrompts
=> true
```

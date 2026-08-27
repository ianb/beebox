# Choosing a chat's engine and model before it exists

A chat's engine is fixed when it starts and never changes after — transcripts
live in different stores per engine, and models are engine-scoped, so a
mid-chat switch would silently change two things at once. That makes the moment
*before* the first message the only moment the choice can be made, and it is a
moment when the chat has no id, no history entry and no model file.

Two carriers, decided by whether the harness will accept an id we chose:

- **Claude** takes a coined id, so the choice rides the reservation.
- **Anything else** cannot, so the choice rides the `"new"` send — which is how
  every Codex chat is created already.

```ts setup
import { resolveChatEngine, resolveStartEngine } from "../../src/core/chat/session/engine.js";
import { reserveChatSession, ChatReservationStore } from "../../src/core/chat/session/reserve.js";
import { clearBoxConfigCache } from "../../src/core/box/config.js";
import { recordSessionStart } from "../../src/core/chat/session/session-start-record.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

async function configure(boxRoot: string, config: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.join(boxRoot, "config"), { recursive: true });
  await fs.writeFile(path.join(boxRoot, "config/box.json"), JSON.stringify(config));
  clearBoxConfigCache(boxRoot);
}
```

A chat with no id takes the requested engine; the box default answers when
nothing was requested.

```ts
const box = await makeTmpBox();
await configure(box.root, { agentEngine: "claude", engines: { claude: true, codex: true } });

JSON.stringify([
  await resolveStartEngine(box.root, { sessionId: null, requested: null }),
  await resolveStartEngine(box.root, { sessionId: null, requested: "codex" }),
  await resolveChatEngine(box.root, { sessionId: null }),
])
=> ["claude","codex","claude"]
```

Once the chat has a recorded engine, that is the answer — a request cannot
change it. This is the "fixed at birth" rule, enforced where it is read rather
than trusted to the UI.

```ts continue
const sessionId = randomUUID();
await recordSessionStart(box.root, { sessionId, engine: "codex" });

JSON.stringify([
  await resolveChatEngine(box.root, { sessionId }),
  await resolveStartEngine(box.root, { sessionId, requested: "claude" }),
])
=> ["codex","codex"]
```

A COINED id is not yet a record: the id exists from the first request, before
any husk or history entry does. The picker's request must win there — falling
through to the box default sent a `?engine=claude` coined start on a
codex-default box into the coined-must-be-Claude invariant (a 500,
2026-08-27). Recorded > requested > box default. (This box's default is
claude, so the second entry below is the default answering.)

```ts continue
const coinedFresh = randomUUID();
JSON.stringify([
  await resolveStartEngine(box.root, { sessionId: coinedFresh, requested: "claude" }),
  await resolveStartEngine(box.root, { sessionId: coinedFresh, requested: null }),
])
=> ["claude","claude"]
```

A reservation carries the chosen model, and refuses a non-Claude engine —
`unsupported`, not an error, because the client's answer to it is to send
`"new"` instead.

```ts continue
const store = new ChatReservationStore(() => Date.now());
const coined = randomUUID();
const reserved = await reserveChatSession({
  boxRoot: box.root,
  store,
  sessionId: coined,
  contextDir: null,
  seedFeatures: {},
  model: "claude-fable-5",
});

JSON.stringify([reserved.kind, store.get(coined)?.model, store.get(coined)?.engine])
=> ["reserved","claude-fable-5","claude"]

const codexReserved = await reserveChatSession({
  boxRoot: box.root,
  store,
  sessionId: randomUUID(),
  contextDir: null,
  seedFeatures: {},
  requestedEngine: "codex",
});
codexReserved.kind
=> unsupported

await box.cleanup();
```

A reservation on a Codex-default box still answers `unsupported` — only Claude
accepts an id we chose — but the client must ask with the engine it actually
wants, or a chat the user asked to run on Claude is refused for the box's own
default and loses its id.

```ts
const codexBox = await makeTmpBox();
await configure(codexBox.root, { agentEngine: "codex", engines: { claude: true, codex: true } });
const codexStore = new ChatReservationStore(() => Date.now());

const asked = await reserveChatSession({
  boxRoot: codexBox.root,
  store: codexStore,
  sessionId: randomUUID(),
  contextDir: null,
  seedFeatures: {},
  requestedEngine: "claude",
});
const unasked = await reserveChatSession({
  boxRoot: codexBox.root,
  store: codexStore,
  sessionId: randomUUID(),
  contextDir: null,
  seedFeatures: {},
});

JSON.stringify([asked.kind, unasked.kind])
=> ["reserved","unsupported"]

await codexBox.cleanup();
```

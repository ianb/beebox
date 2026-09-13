# Chat Features: Persistence

Feature flags live on `SessionHistoryEntry` in
`.beebox/chat-session-history.json`. `updateFeaturesForSession`
writes a partial update; `getFeaturesForSession` reads what's there.
Pre-existing sessions without a `features` field continue working —
missing means "all defaults," resolved at read time by `resolveFeatures`
(covered in `chat-features.doctest.md`).

```ts setup
import {
  appendHistory,
  getFeaturesForSession,
  loadHistoryEntries,
  updateFeaturesForSession,
} from "../../src/core/chat/session/history.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { resolveRecordedChatEngine } from "../../src/core/chat/session/engine.js";
import { reserveChatSession, ChatReservationStore } from "../../src/core/chat/session/reserve.js";
import { clearBoxConfigCache, loadAgentEngine } from "../../src/core/box/config.js";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
```

## Reading from an unknown session

```ts
const box = await makeTmpBox();
await getFeaturesForSession(box.root, "sess-1")
=> null
```

```ts cleanup
await box.cleanup();
```

## Writing then reading

`updateFeaturesForSession` creates the entry if it doesn't exist yet.
This matters for the agent-delta path: the agent might emit a
`<chat-app>` mutation in its first turn, before any explicit toggle.

Creating the entry WRITES the session's engine, so `engine` is a required
argument rather than something this function decides — see "A toggle does not
restamp the engine" below for what filling it in by default cost.

```ts
const box = await makeTmpBox();
await updateFeaturesForSession(box.root, {
  sessionId: "sess-1",
  updates: { narration: "on" },
  engine: "claude",
});
JSON.stringify(await getFeaturesForSession(box.root, "sess-1"))
=> {"narration":"on"}
```

```ts cleanup
await box.cleanup();
```

## Partial updates merge

Only the keys passed to `updateFeaturesForSession` change; existing
keys not in the update are preserved.

```ts
const box = await makeTmpBox();
await updateFeaturesForSession(box.root, {
  sessionId: "sess-1",
  updates: { narration: "on", prose: "off" },
  engine: "claude",
});
await updateFeaturesForSession(box.root, {
  sessionId: "sess-1",
  updates: { prose: "on" },
  engine: "claude",
});
JSON.stringify(await getFeaturesForSession(box.root, "sess-1"))
=> {"narration":"on","prose":"on"}
```

```ts cleanup
await box.cleanup();
```

## Coexists with contextDir

Existing sessions added via `appendHistory` keep their `contextDir` —
updating features doesn't disturb it, and vice versa.

```ts
const box = await makeTmpBox();
await appendHistory(box.root, { sessionId: "sess-1", contextDir: "_content/recipes" });
await updateFeaturesForSession(box.root, {
  sessionId: "sess-1",
  updates: { narration: "on" },
  engine: "claude",
});
const entries = await loadHistoryEntries(box.root);
JSON.stringify(entries[0])
=> {"id":"sess-1","engine":"claude","contextDir":"_content/recipes","features":{"narration":"on"}}
```

```ts cleanup
await box.cleanup();
```

## A toggle does not restamp the engine

Creating an entry writes an engine, and this function cannot know which one.
It used to fill the gap with the box default, which overwrote the answer the
session already had.

The reachable case: a chat reserved as `claude` on a **codex-default** box. The
reservation is its only record before the first message, and
`resolveRecordedChatEngine` prefers a history row over a reservation — so the
row this toggle creates decides the engine from then on. Stamping the box
default flipped a Claude chat to Codex, permanently, on its first feature
toggle, and coined chats must be Claude.

```ts
const box = await makeTmpBox();
await mkdir(join(box.root, "_config"), { recursive: true });
await writeFile(join(box.root, "_config/box.json"), JSON.stringify({ agentEngine: "codex", engines: { claude: true, codex: true } }));
clearBoxConfigCache(box.root);

const store = new ChatReservationStore(() => Date.now());
const coined = randomUUID();
const reserved = await reserveChatSession({
  boxRoot: box.root, store, sessionId: coined,
  contextDir: null, seedFeatures: {}, requestedEngine: "claude",
});
print(`reserved: ${reserved.kind}`);
print(`recorded before: ${String(await resolveRecordedChatEngine(box.root, { sessionId: coined }))}`);
=>
reserved: reserved
recorded before: claude
```

The caller resolves the engine the way every reader does and passes it in, so
the reservation's answer survives:

```ts continue
const engine = (await resolveRecordedChatEngine(box.root, { sessionId: coined }))
  ?? (await loadAgentEngine(box.root));
await updateFeaturesForSession(box.root, { sessionId: coined, updates: { narration: "on" }, engine });

print(`recorded after:  ${String(await resolveRecordedChatEngine(box.root, { sessionId: coined }))}`);
print(`features kept:   ${JSON.stringify(await getFeaturesForSession(box.root, coined))}`);
=>
recorded after:  claude
features kept:   {"narration":"on"}
```

```ts cleanup
await box.cleanup();
```

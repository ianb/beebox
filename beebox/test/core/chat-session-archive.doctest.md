# Archiving a dead chat

A chat whose transcript is gone can't be resumed, but its card is still a
record worth keeping. Archiving moves that card from `store/chat/web/` to
`store/chat/archive/` — and because `listChatHusks` reads `web/` only, that one
move takes the chat out of every list and out of the review corpus without
deleting anything (`docs/implemented-plans/chat-session-identity.md`, Track 3).

The eligibility rule is the whole point: a chat whose transcript is still here
is refused. Archiving a live conversation would hide something the boxholder
can still open.

```ts setup
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { archiveChatSession } from "../../src/core/chat/session/archive.js";
import { loadDeadHusks, listSessionEntries } from "../../src/core/chat/session/list.js";
import { listChatHusks, listChatHusksUnder } from "../../src/core/chat/husk-read.js";
import { getSessionLogPath } from "../../src/core/chat/session/transcript-paths.js";
import { localOrigin } from "../../src/core/chat/session/origin.js";
import { ChatSessionRegistry } from "../../src/core/chat/session/registry.js";
import { createFakeChatBackend } from "../../src/services/claude-chat.js";

/** Archiving asks the registry whether the chat is still open, so every call needs one. */
function idleRegistry(box) {
  return new ChatSessionRegistry(box.root, { backend: createFakeChatBackend() });
}

const DEAD = "22222222-2222-4222-8222-222222222222";
const LIVE = "11111111-1111-4111-8111-111111111111";
```

## A dead husk is filed away, and leaves every list

```ts
const box = await makeTmpBox({ git: true });
const here = await localOrigin();
await mkdir(box.path("store/chat/web"), { recursive: true });
await writeFile(
  box.path("store/chat/web/2026-08-19_22222222.chat.card"),
  `---\nsession: ${DEAD}\ntitle: Sourdough attempt\norigin: ${here.id}\norigin-name: ${here.name}\n---\n\nNotes from the chat.\n`,
);
// Husks are committed cards; the move is a change to a tracked file.
box.commitAll("seed husk");

const registry = idleRegistry(box);
const archived = await archiveChatSession({ boxRoot: box.root, sessionId: DEAD, registry });
JSON.stringify(archived)
=> {"status":"archived","sessionId":"22222222-2222-4222-8222-222222222222","from":"store/chat/web/2026-08-19_22222222.chat.card","to":"store/chat/archive/2026-08-19_22222222.chat.card","transcript":{"state":"expired"}}
```

Nothing is gone — the card is a card, at a new path — but the enumerations that
feed the chat UI no longer see it, dead list included.

```ts continue
JSON.stringify({
  web: (await listChatHusks(box.root)).map((h) => h.path),
  archive: (await listChatHusksUnder(box.root, "store/chat/archive")).map((h) => h.path),
  dead: (await loadDeadHusks(box.root)).map((h) => h.sessionId),
})
=> {"web":[],"archive":["store/chat/archive/2026-08-19_22222222.chat.card"],"dead":[]}

(await box.read("store/chat/archive/2026-08-19_22222222.chat.card")).includes("Notes from the chat.")
=> true
```

## Archiving twice is the same as archiving once

The second call has nothing to move and says so, rather than reporting the
already-filed chat as missing.

```ts continue
JSON.stringify(await archiveChatSession({ boxRoot: box.root, sessionId: DEAD, registry }))
=> {"status":"already-archived","sessionId":"22222222-2222-4222-8222-222222222222","huskPath":"store/chat/archive/2026-08-19_22222222.chat.card"}
```

```ts continue cleanup
registry.shutdown();
await box.cleanup();
```

## A chat whose transcript is still here is refused

Refusal is a result, not an exception: "that one is still alive" is an answer
the UI shows.

```ts
const box = await makeTmpBox({ git: true });
const here = await localOrigin();
await mkdir(box.path("store/chat/web"), { recursive: true });
const logPath = getSessionLogPath(box.root, LIVE);
await mkdir(dirname(logPath), { recursive: true });
await writeFile(logPath, "{}\n");
await writeFile(
  box.path("store/chat/web/2026-08-20_11111111.chat.card"),
  `---\nsession: ${LIVE}\norigin: ${here.id}\n---\n\n`,
);

const registry = idleRegistry(box);
JSON.stringify(await archiveChatSession({ boxRoot: box.root, sessionId: LIVE, registry }))
=> {"status":"refused","sessionId":"11111111-1111-4111-8111-111111111111","reason":"transcript-present","huskPath":"store/chat/web/2026-08-20_11111111.chat.card"}

JSON.stringify((await listSessionEntries(box.root)).map((e) => e.sessionId))
=> ["11111111-1111-4111-8111-111111111111"]
```

A session with no card at all is neither archived nor refused.

```ts continue
JSON.stringify(await archiveChatSession({ boxRoot: box.root, sessionId: "33333333-3333-4333-8333-333333333333", registry }))
=> {"status":"not-found","sessionId":"33333333-3333-4333-8333-333333333333"}
```

```ts continue cleanup
registry.shutdown();
await box.cleanup();
```

## A chat the server is holding is refused, transcript or no transcript

A chat is resumable from the moment its id is assigned, which is before the
engine has written anything. On disk that looks exactly like an expired chat —
husk, no transcript — so the dead list alone would hand the boxholder's open
conversation to the archive move. The registry is asked as well.

```ts
const box = await makeTmpBox({ git: true });
const here = await localOrigin();
await box.write(
  "store/chat/web/2026-08-26_11111111.chat.card",
  `---\nsession: ${LIVE}\norigin: ${here.id}\n---\n\n`,
);
box.commitAll("seed husk");
const registry = idleRegistry(box);

// Nothing holds the session yet: with no transcript either, the husk is dead
// and archiving is allowed.
JSON.stringify((await loadDeadHusks(box.root)).map((h) => h.sessionId))
=> ["11111111-1111-4111-8111-111111111111"]
```

```ts continue
// The chat page opens it: the registry now has the session, and the same husk
// is refused — with a reason that says why, since the transcript is still absent.
registry.getOrCreate(LIVE);

JSON.stringify(await archiveChatSession({ boxRoot: box.root, sessionId: LIVE, registry }))
=> {"status":"refused","sessionId":"11111111-1111-4111-8111-111111111111","reason":"session-live","huskPath":"store/chat/web/2026-08-26_11111111.chat.card"}

JSON.stringify((await listChatHusks(box.root)).map((h) => h.path))
=> ["store/chat/web/2026-08-26_11111111.chat.card"]
```

```ts continue cleanup
registry.shutdown();
await box.cleanup();
```

# `chat.sessions`: one enumeration and one labelling order for every session list

There used to be two session-list codepaths that disagreed. `chat.byLandmark`
(the landmark picker) enumerates husk cards and reads the husk's `title`;
`chat.sessions` — the query the chat history dropdown actually calls — read the
history JSON and never looked at a husk at all, so a title set by hand or written
by the nightly chat review was invisible where it mattered most, and a husk the
boxholder deleted vanished from the picker but lingered in the dropdown.

Both now go through `loadAllSessions` (husk cards are the source of truth for
which chats exist) and `resolveSessionLabel` (husk `title`, then the
transcript's first user message, then the session-id prefix).

```ts setup
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { getSessionLogPath } from "../../src/core/chat/session/transcript-paths.js";

function caller(boxRoot) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
  };
  return appRouter.createCaller(ctx);
}

async function seedTranscript(boxRoot: string, sessionId: string, firstMessage: string) {
  const logPath = getSessionLogPath(boxRoot, sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  const entry = {
    type: "user",
    uuid: `u-${sessionId}`,
    timestamp: "2026-07-28T03:00:00Z",
    message: { role: "user", content: [{ type: "text", text: firstMessage }] },
  };
  await writeFile(logPath, JSON.stringify(entry) + "\n");
}
```

## A husk title beats the first-message snippet

```ts
const box = await makeTmpBox();
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

await seedTranscript(box.root, "titled01", "hey can you look at the thing from yesterday");
await seedTranscript(box.root, "untitled1", "what's on my calendar tomorrow");

// Both sessions have a husk; only the first one carries a title.
await box.write("_content/chat/web/2026-07-28_titled01.chat.card",
  "---\nsession: titled01\ntitle: Chasing down a duplicate charge\n---\n\n");
await box.write("_content/chat/web/2026-07-28_untitled1.chat.card",
  "---\nsession: untitled1\n---\n\n");

const { sessions } = await caller(box.root).chat.sessions();
sessions.map((s) => `${s.sessionId}: ${s.label}`).toSorted().join("\n")
=>
titled01: Chasing down a duplicate charge
untitled1: what's on my calendar tomorrow
```

## Husks are the enumeration, so the two lists can't drift

A session with a transcript but no husk is not listed — deleting a husk is
editorial removal from the dropdown, the same as from the picker. (The history
JSON no longer decides membership; husks are written eagerly when a session id
is assigned, and pre-husk history is backfilled once on boot.)

```ts continue
await seedTranscript(box.root, "huskless", "this one has no card");
await box.write(".beebox/chat-session-history.json",
  JSON.stringify({ sessions: [{ id: "titled01" }, { id: "huskless" }] }, null, 2));

const listed = await caller(box.root).chat.sessions();
listed.sessions.some((s) => s.sessionId === "huskless")
=> false
```

A husk whose transcript is gone is skipped too — there's nothing to resume,
though the card stays browsable.

```ts continue
await box.write("_content/chat/web/2026-07-28_notrans1.chat.card",
  "---\nsession: notrans1\n---\n\n");

const stillGone = await caller(box.root).chat.sessions();
stillGone.sessions.some((s) => s.sessionId === "notrans1")
=> false
```

A session whose transcript exists but can't be parsed still lists — it falls
back to the id prefix rather than failing the whole list. (Expect a
`skipping unparseable JSONL line` warning below; that's the fixture.)

```ts continue
await mkdir(dirname(getSessionLogPath(box.root, "garbled9")), { recursive: true });
await writeFile(getSessionLogPath(box.root, "garbled9"), "not json at all\n");
await box.write("_content/chat/web/2026-07-28_garbled9.chat.card",
  "---\nsession: garbled9\n---\n\n");

const garbled = await caller(box.root).chat.sessions();
garbled.sessions.find((s) => s.sessionId === "garbled9").label
=> garbled9
```

```ts cleanup
await box.cleanup();
```

## Each row carries its landmark, so the dropdown can group by it

`contextDir` is the session's binding ("" for root-bound and for legacy sessions
that predate bindings); `landmarkLabel` is that landmark's display name,
resolved server-side so the dropdown doesn't have to.

```ts
const box = await makeTmpBox();
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

await box.write("_content/recipes/Recipes.landmark.card",
  "---\nnavigation:\n  label: Recipes\n  symbol: \"🍳\"\n---\n\n");

await seedTranscript(box.path("_content/recipes"), "inrecipe1", "what can I make with lentils");
await seedTranscript(box.root, "rootchat1", "how's my week looking");

await box.write("_content/chat/web/2026-07-28_inrecipe1.chat.card",
  "---\nsession: inrecipe1\ncontext-dir: _content/recipes\n---\n\n");
await box.write("_content/chat/web/2026-07-28_rootchat1.chat.card",
  "---\nsession: rootchat1\n---\n\n");

const { sessions } = await caller(box.root).chat.sessions();
sessions.map((s) => `${s.sessionId} [${s.contextDir}] ${s.landmarkLabel}`).toSorted().join("\n")
=>
inrecipe1 [_content/recipes] Recipes
rootchat1 [] Root
```

A session bound to a directory with no landmark card (deleted, or never one)
still says where it lives — the directory itself is the fallback label.

```ts continue
await seedTranscript(box.path("_content/orphan"), "orphaned1", "leftover thread");
await box.write("_content/chat/web/2026-07-28_orphaned1.chat.card",
  "---\nsession: orphaned1\ncontext-dir: _content/orphan\n---\n\n");

const after = await caller(box.root).chat.sessions();
const orphan = after.sessions.find((s) => s.sessionId === "orphaned1");
`${orphan.contextDir} / ${orphan.landmarkLabel}`
=> _content/orphan / _content/orphan
```

```ts cleanup
await box.cleanup();
```

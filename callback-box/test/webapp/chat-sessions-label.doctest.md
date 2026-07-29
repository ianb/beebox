# `chat.sessions`: one labelling order for every session list

There used to be two session-list codepaths that disagreed. `trpc/routers/chat.ts`
read the husk's `title`; `chat.sessions` — the query the chat history dropdown
actually calls — never looked at a husk at all, so a title set by hand or written
by the nightly chat review was invisible where it mattered most.

Both now resolve through `resolveSessionLabel`: husk `title`, then the
transcript's first user message, then the session-id prefix.

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
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

await box.write(".callback-box/chat-session-history.json",
  JSON.stringify({ sessions: [{ id: "titled01" }, { id: "untitled1" }] }, null, 2));

await seedTranscript(box.root, "titled01", "hey can you look at the thing from yesterday");
await seedTranscript(box.root, "untitled1", "what's on my calendar tomorrow");

// Only the first session has a husk carrying a title.
await box.write("store/chat/web/2026-07-28_titled01.chat.card",
  "---\nsession: titled01\ntitle: Chasing down a duplicate charge\n---\n\n");

const { sessions } = await caller(box.root).chat.sessions();
sessions.map((s) => `${s.sessionId}: ${s.label}`).toSorted().join("\n")
=>
titled01: Chasing down a duplicate charge
untitled1: what's on my calendar tomorrow
```

A husk with no title falls through to the snippet, exactly as before — the title
is an override, not a requirement.

```ts continue
await box.write("store/chat/web/2026-07-28_untitled1.chat.card",
  "---\nsession: untitled1\n---\n\n");

const after = await caller(box.root).chat.sessions();
after.sessions.find((s) => s.sessionId === "untitled1").label
=> what's on my calendar tomorrow
```

A session whose transcript is unreadable falls back to the id prefix rather than
failing the whole list.

```ts continue
await box.write(".callback-box/chat-session-history.json",
  JSON.stringify({ sessions: [{ id: "titled01" }, { id: "untitled1" }, { id: "gone9999" }] }, null, 2));

const withGhost = await caller(box.root).chat.sessions();
withGhost.sessions.find((s) => s.sessionId === "gone9999").label
=> gone9999
```

```ts cleanup
await box.cleanup();
```

# `chat.markDone`: the boxholder's close mark on a chat

A finished conversation should not sit in the chat list looking like a live
one. `chat.markDone` sets `done: true` on the chat's husk card, and
`chat.sessions` reports it so the Recent chats panel can sort done chats into
their own muted group below the live ones (`docs/implemented-plans/chat-titles.md`
§ Track D). Done is a state, not a deletion: the chat stays listed and
resumable, and the nightly review ignores the mark.

```ts setup
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";

const SESSION = "aaaa1111-2222-4333-8444-555566667777";
const OTHER = "bbbb1111-2222-4333-8444-555566667777";

function caller(boxRoot) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    isOwner: true,
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
  };
  return appRouter.createCaller(ctx);
}

async function seedChat(box, sessionId: string, husk: string) {
  const logPath = getSessionLogPath(box.root, sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, JSON.stringify({
    type: "user", uuid: `u-${sessionId}`, timestamp: "2026-07-28T03:00:00Z",
    message: { role: "user", content: [{ type: "text", text: "hello" }] },
  }) + "\n");
  await box.write(`_content/chat/web/2026-07-28_${sessionId.slice(0, 8)}.chat.card`, `---\nsession: ${sessionId}\n${husk}---\n\nNotes the boxholder wrote.\n`);
}

/** Each listed chat as `<id prefix> done|live`, sorted. */
async function listed(boxRoot) {
  const { sessions } = await caller(boxRoot).chat.sessions();
  return sessions.map((s) => `${s.sessionId.slice(0, 8)} ${s.done ? "done" : "live"}`).toSorted();
}
```

## Marking a chat done writes the husk and the list reports it

The mark is one frontmatter field. The body the boxholder wrote is carried
through untouched.

```ts
const box = await makeTmpBox();
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
await seedChat(box, SESSION, "title: Planning a small birthday dinner\n");
await seedChat(box, OTHER, "");

await caller(box.root).chat.markDone({ sessionId: SESSION, done: true })
=> { huskPath: "_content/chat/web/2026-07-28_aaaa1111.chat.card", done: true }

await box.read("_content/chat/web/2026-07-28_aaaa1111.chat.card")
=> ---
session: aaaa1111-2222-4333-8444-555566667777
title: Planning a small birthday dinner
done: true
---
«blankline»
Notes the boxholder wrote.

await listed(box.root)
=> ["aaaa1111 done", "bbbb1111 live"]
```

The session menu reads the mark for the current chat through `chat.label`, so
its toggle can say "Mark active" instead of "Mark done".

```ts continue
await caller(box.root).chat.label({ session: SESSION })
=> { label: "Planning a small birthday dinner", done: true }
```

## Unmarking clears the field

The field is removed rather than set to `false`: its absence means active.

```ts continue
await caller(box.root).chat.markDone({ sessionId: SESSION, done: false });
await box.read("_content/chat/web/2026-07-28_aaaa1111.chat.card")
=> ---
session: aaaa1111-2222-4333-8444-555566667777
title: Planning a small birthday dinner
---
«blankline»
Notes the boxholder wrote.


await listed(box.root)
=> ["aaaa1111 live", "bbbb1111 live"]
```

```ts cleanup
await box.cleanup();
```

## A chat with no card cannot be marked

A brand-new chat has no husk yet, so there is nothing to mark. `chat.label`
reports `done: null` for it, and the session menu offers no toggle at all.

```ts
const box = await makeTmpBox();
await caller(box.root).chat.label({ session: SESSION })
=> { label: null, done: null }
```

Calling the mutation anyway is refused, rather than inventing a card.

```ts continue
await caller(box.root).chat.markDone({ sessionId: SESSION, done: true }).catch((e) => e.message)
=> This chat has no card to mark
```

```ts cleanup
await box.cleanup();
```

## A hand-written non-boolean `done` reads as active, with a warning

`done` is a named boolean. A hand-edited `done: "finished"` fails card
validation, and the chat lists read it as absent and warn rather than sorting
on a value nothing defined.

```ts
const box = await makeTmpBox();
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
await seedChat(box, SESSION, "done: finished\n");

const warnings = [];
const warn = console.warn;
console.warn = (...args) => { warnings.push(args.join(" ")); };
const rows = await listed(box.root);
console.warn = warn;

rows
=> ["aaaa1111 live"]

warnings.filter((w) => w.includes("non-boolean done"))
=> ['chat-husk: _content/chat/web/2026-07-28_aaaa1111.chat.card has a non-boolean done "finished"; ignoring it']
```

```ts cleanup
await box.cleanup();
```

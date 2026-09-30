# Browser-task procedures

`browserTask.setClosed` is the boxholder's open/closed control on a task card:
an owner-only, locked read-modify-write of the `closed` field (removed on
reopen, since absent means open), committed with its own endpoint trailer. The executor never calls it.

```ts setup
import { execFileSync } from "node:child_process";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { createBrowserTaskTemplate } from "../../../../src/schemas/browser-task.js";

function caller(boxRoot: string, options?: { isOwner?: boolean }) {
  return appRouter.createCaller({
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
    user: null,
    authed: true,
    isOwner: options?.isOwner !== false,
  });
}

const box = await makeTmpBox({ git: true });
const cardPath = "_content/tasks/Task.browser-task.card";
await box.write(cardPath, createBrowserTaskTemplate({ title: "Scan", start: "https://example.test/feed", prompt: "Find shows.\n" }));
await box.write("_content/notes/Note.memo.card", "---\ntype: memo\nstatus: new\ncreated: 2026-09-12T00:00:00Z\n---\nA memo.\n");
box.commitAll("seed");
```

## Close, then reopen

```ts
const closed = await caller(box.root).browserTask.setClosed({ path: cardPath, closed: true });
JSON.stringify([closed.closed, typeof closed.commit === "string", closed.commitWarning])
=> [true,true,null]

(await box.read(cardPath)).includes("closed: true")
=> true

execFileSync("git", ["log", "-1", "--format=%B"], { cwd: box.root }).toString().includes("Endpoint: browserTask.setClosed")
=> true

const reopened = await caller(box.root).browserTask.setClosed({ path: cardPath, closed: false });
JSON.stringify([reopened.closed, (await box.read(cardPath)).includes("closed")])
=> [false,false]
```

The body and the other fields survive the round trip:

```ts continue
const after = await box.read(cardPath);
JSON.stringify([after.includes("start:\n  href: https://example.test/feed\n"), after.trim().endsWith("Find shows.")])
=> [true,true]
```

## Listing tasks with their state

`browserTask.list` walks `_content` for task cards and derives each one's
lifecycle state; the dashboard shows the due and never-scanned ones.

```ts continue
await box.write("_content/tasks/Weekly.browser-task.card", "---\ntype: browser-task\ntitle: Weekly feed\nstart:\n  href: https://example.test/w\nrescan-after: P7D\nlast-upload: 2020-01-01T00:00:00Z\n---\nScan it.\n");
box.commitAll("seed weekly");
const listed = await caller(box.root).browserTask.list();
JSON.stringify(listed.items.map((t) => [t.path, t.title, t.closed, t.state.kind, t.inboxCount, t.runCount]))
=> [["_content/tasks/Task.browser-task.card","Scan",false,"never-scanned",0,0],["_content/tasks/Weekly.browser-task.card","Weekly feed",false,"due",0,0]]
```

## Refusals

Not an owner, not a browser-task card, not a card at all:

```ts continue
await caller(box.root, { isOwner: false }).browserTask.setClosed({ path: cardPath, closed: true }).then(() => "accepted", (e) => e.code)
=> FORBIDDEN

await caller(box.root).browserTask.setClosed({ path: "_content/notes/Note.memo.card", closed: true }).then(() => "accepted", (e) => e.code)
=> BAD_REQUEST

await caller(box.root).browserTask.setClosed({ path: "_content/tasks/Nope.browser-task.card", closed: true }).then(() => "accepted", (e) => e.code)
=> NOT_FOUND

await caller(box.root).browserTask.setClosed({ path: "../outside.browser-task.card", closed: true }).then(() => "accepted", (e) => e.code)
=> FORBIDDEN
```

```ts cleanup
await box.cleanup();
```

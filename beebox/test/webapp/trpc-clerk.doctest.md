# clerk tRPC router

The browser-extension endpoints (formerly raw `/api/clerk/*`) as tRPC
procedures: list commentary destinations, and capture a page as a
`.webpage.card` + sibling `.commentary.card`, committed, returning the companion
`open` URL. Invalid input is rejected by Zod; an unknown destination is a clear
error rather than a silent misfile.

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

function caller(boxRoot) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
    user: null,
    authed: true,
    isOwner: true,
  };
  return appRouter.createCaller(ctx);
}
```

## commentary captures a page into the inbox and returns the companion URL

```ts
const box = await makeTmpBox({ git: true });
const res = await caller(box.root).clerk.commentary({
  url: "https://example.com/article",
  title: "An Example Article",
  readableMarkdown: "# Heading\n\nBody text.",
});
// Two cards created: the webpage card and its sibling commentary card.
print(`created: ${res.created.length}`);
print(`webpage: ${res.created.some((p) => p.endsWith(".webpage.card"))}`);
print(`commentary: ${res.created.some((p) => p.endsWith(".commentary.card"))}`);
print(`filed in inbox: ${res.created[0].startsWith("box/inbox/")}`);
print(`open startsWith chat: ${res.open.startsWith("chat?session=new")}`);
=>
created: 2
webpage: true
commentary: true
filed in inbox: true
open startsWith chat: true
```

## the webpage card holds the readable body + source provenance

```ts continue
const webpageRel = res.created.find((p) => p.endsWith(".webpage.card"));
const body = await readFile(path.join(box.root, webpageRel), "utf-8");
print(body.includes("https://example.com/article"));
print(body.includes("Body text."));
=>
true
true
```

## an unknown destination is rejected

```ts continue
const err = await caller(box.root).clerk.commentary({
  url: "https://example.com/x",
  title: "X",
  readableMarkdown: "body",
  destinationDir: "box/does-not-exist",
}).then(() => "no-error", (e) => e.code);
print(err);
=>
BAD_REQUEST
```

## invalid input (bad url) is rejected by Zod

```ts continue
const err2 = await caller(box.root).clerk.commentary({
  url: "not-a-url",
  title: "X",
  readableMarkdown: "body",
}).then(() => "no-error", (e) => e.code);
print(err2);
=>
BAD_REQUEST
```

## tab arrangements are created once and retries are idempotent

```ts continue
const transferId = "00000000-0000-4000-8000-000000000000";
const windowId = "10000000-0000-4000-8000-000000000000";
const tabId = "20000000-0000-4000-8000-000000000000";
const arrangement = {
  transferId,
  scope: "current-window",
  capturedAt: "2026-08-04T12:00:00.000Z",
  source: { windows: [{ id: windowId, tabs: [{ id: tabId, title: "Example", url: "https://example.com", pinned: false }] }] },
  proposal: { windows: [{ id: windowId, tabs: [tabId] }], close: [] },
};
const first = await caller(box.root).clerk.tabArrangement(arrangement);
const retry = await caller(box.root).clerk.tabArrangement(arrangement);
const saved = await readFile(path.join(box.root, first.card), "utf-8");
print(`same card: ${first.card === retry.card}`);
print(`in inbox: ${first.card.startsWith("box/inbox/")}`);
print(`opens organizer: ${first.open.includes("companion=")}`);
print(`draft: ${saved.includes("status: draft")}`);
=>
same card: true
in inbox: true
opens organizer: true
draft: true
```

## a transfer ID cannot be retried with a different source snapshot

```ts continue
const conflict = await caller(box.root).clerk.tabArrangement({
  ...arrangement,
  source: { windows: [{ id: windowId, tabs: [{ id: tabId, title: "Changed", url: "https://changed.example", pinned: false }] }] },
}).then(() => "no-error", (e) => e.code);
print(conflict);
=>
CONFLICT
```

## commentaryDestinations lists commentary spots and passes the output schema

The query carries a Zod `.output(commentaryDestinationsOutput)` — a real box
response (including a `symbol: null` landmark) must satisfy it, otherwise tRPC
throws before returning. Seed one landmark with a symbol and one without, then
list.

```ts
const dbox = await makeTmpBox({ git: true });
async function seedLandmark(dir, cardBody) {
  await mkdir(path.join(dbox.root, dir), { recursive: true });
  await writeFile(path.join(dbox.root, dir, `${path.basename(dir)}.landmark.card`), cardBody, "utf-8");
}
await seedLandmark("store/reading", `---
navigation:
  label: Reading
  symbol: 📚
destinations:
  - for: [commentary]
    rules: Reading list.
---
`);
await seedLandmark("store/notes", `---
navigation:
  label: Notes
destinations:
  - for: [commentary]
    rules: Loose notes.
---
`);
const dest = await caller(dbox.root).clerk.commentaryDestinations();
print(JSON.stringify(dest, null, 2));
=>
{
  "destinations": [
    {
      "dir": "store/notes",
      "label": "Notes",
      "symbol": null
    },
    {
      "dir": "store/reading",
      "label": "Reading",
      "symbol": "📚"
    }
  ]
}
```

```ts cleanup
await dbox.cleanup();
```

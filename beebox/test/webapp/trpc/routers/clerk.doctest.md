# clerk tRPC router

The browser-extension endpoints (formerly raw `/api/clerk/*`) as tRPC
procedures: list commentary destinations, and capture a page as a
`.webpage.card` + sibling `.commentary.card`, committed, returning the companion
`open` URL. Invalid input is rejected by Zod; an unknown destination is a clear
error rather than a silent misfile.

```ts setup
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
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
print(`filed in inbox: ${res.created[0].startsWith("_content/inbox/")}`);
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
  destinationDir: "_content/does-not-exist",
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

## a retried capture replays the first result instead of writing again

The extension sends one `captureId` per capture and resends it when it retries
a lost response. The retry returns the same paths, and the box holds one
webpage card and one commit. Two concurrent attempts with one id also write
once. A capture without an id (an older extension) still writes normally.

```ts continue
const { execFileSync } = await import("node:child_process");
const commits = () => execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: box.root, encoding: "utf-8" }).trim();
const webpages = async () => (await readdir(path.join(box.root, "_content/inbox"))).filter((n) => n.endsWith(".webpage.card")).length;
const capture = {
  url: "https://example.com/retry",
  title: "Retry Me",
  readableMarkdown: "Retry body.",
  frozenHtml: "<html>frozen</html>",
  captureId: "30000000-0000-4000-8000-000000000000",
};
const before = { commits: commits(), webpages: await webpages() };
const firstCapture = await caller(box.root).clerk.commentary(capture);
const [retryA, retryB] = await Promise.all([
  caller(box.root).clerk.commentary(capture),
  caller(box.root).clerk.commentary(capture),
]);
const card = await readFile(path.join(box.root, firstCapture.created[0]), "utf-8");
print(`paths: ${firstCapture.created.map((p) => path.basename(p).replace(/_[\d-]+T[\dT-]+/u, "_<ts>")).join(", ")}`);
print(`replayed: ${JSON.stringify(retryA) === JSON.stringify(firstCapture) && JSON.stringify(retryB) === JSON.stringify(firstCapture)}`);
print(`stores capture-id: ${card.includes(`capture-id: ${capture.captureId}`)}`);
print(`new webpage cards: ${(await webpages()) - before.webpages}`);
print(`new commits: ${Number(commits()) - Number(before.commits)}`);
=>
paths: Retry_Me_<ts>.webpage.card, page.frozen, Retry_Me_<ts>.commentary.card
replayed: true
stores capture-id: true
new webpage cards: 1
new commits: 1
```

## a retry after a crash between the write and its commit commits the capture

The first attempt wrote its cards but died before committing. The retry finds
them by `capture-id`, commits them, and acknowledges the capture; git is the
state, so a replied capture is a committed one.

```ts continue
const crashed = {
  url: "https://example.com/crashed",
  title: "Crashed Once",
  readableMarkdown: "Crashed body.",
  captureId: "40000000-0000-4000-8000-000000000000",
};
await writeFile(
  path.join(box.root, "_content/inbox/Crashed_Once_2026-09-30T00-00-00.webpage.card"),
  `---\ntitle: Crashed Once\nsources:\n  - href: https://example.com/crashed\n    retrieved: 2026-09-30T00:00:00.000Z\ncapture-id: ${crashed.captureId}\n---\nCrashed body.\n`,
);
const uncommittedBefore = commits();
const recovered = await caller(box.root).clerk.commentary(crashed);
print(`acknowledged: ${recovered.created.length > 0}`);
print(`new commits: ${Number(commits()) - Number(uncommittedBefore)}`);
print(`webpage cards for it: ${(await readdir(path.join(box.root, "_content/inbox"))).filter((n) => n.startsWith("Crashed_Once")).length}`);
=>
acknowledged: true
new commits: 1
webpage cards for it: 1
```

## a capture ID reused for a different page is a conflict

```ts continue
const reused = await caller(box.root).clerk.commentary({ ...capture, url: "https://example.com/other" })
  .then(() => "no-error", (e) => e.code);
print(reused);
=>
CONFLICT
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
print(`in inbox: ${first.card.startsWith("_content/inbox/")}`);
print(`opens organizer: ${first.open.includes("companion=")}`);
print(`draft (not ready): ${!saved.includes("ready:")}`);
=>
same card: true
in inbox: true
opens organizer: true
draft (not ready): true
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
await seedLandmark("_content/reading", `---
symbol:
  glyph: 📚
navigation:
  label: Reading
destinations:
  - for: [commentary]
    rules: Reading list.
---
`);
await seedLandmark("_content/notes", `---
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
      "dir": "_content/notes",
      "label": "Notes",
      "symbol": null
    },
    {
      "dir": "_content/reading",
      "label": "Reading",
      "symbol": "📚"
    }
  ]
}
```

```ts cleanup
await dbox.cleanup();
```

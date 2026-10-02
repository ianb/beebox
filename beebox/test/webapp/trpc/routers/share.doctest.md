# iOS share-sheet tRPC contract

The native Share Extension gets a small destination list and can save URL or
plain-text values without going through a chat. Saved URLs use the same webpage
card type and fallback body as Clerk.

```ts setup
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { shareDestinationsOutput } from "../../../../src/webapp/trpc/routers/share/contract.js";
import { parse, stringify } from "yaml";
import { splitCardContent } from "../../../../src/cards/frontmatter.js";
import { planSourceFields } from "../../../../src/scripts/migrate/card-fields/source.js";
import { applyFieldEdits } from "../../../../src/core/card-fields/field-edits.js";

function caller(boxRoot) {
  return appRouter.createCaller({
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
    user: null,
    authed: true,
    isOwner: false,
  });
}
```

The TypeScript contract accepts the same non-batched tRPC envelope fixture that
the native XCTest decodes:

```ts
const fixture = JSON.parse(await readFile("test/mobile-contract/fixtures/share-destinations.json", "utf-8"));
shareDestinationsOutput.parse(fixture.result.data).chats[0].sessionId
=> session-reading
```

## Destinations include Inbox and only landmarks advertising share

```ts
const box = await makeTmpBox({ git: true });
await mkdir(path.join(box.root, "_content/reading"), { recursive: true });
await writeFile(path.join(box.root, "_content/reading/Reading.landmark.card"), `---
navigation:
  label: Reading
  symbol: 📚
destinations:
  - for: [share]
---
`, "utf-8");
await mkdir(path.join(box.root, "_content/private"), { recursive: true });
await writeFile(path.join(box.root, "_content/private/Private.landmark.card"), `---
navigation:
  label: Private
destinations:
  - for: [triage]
---
`, "utf-8");
const destinations = await caller(box.root).share.destinations();
print(JSON.stringify(destinations.saves));
destinations.chats.length
=>
[{"destination":{"kind":"inbox"},"label":"Inbox","symbol":null},{"destination":{"kind":"landmark","dir":"_content/reading"},"label":"Reading","symbol":"📚"}]
0
```

## URL saves are Clerk-compatible and idempotent after a move

```ts continue
const request = {
  kind: "url" as const,
  shareId: "00000000-0000-4000-8000-000000000001",
  url: "https://example.com/article",
  title: "An Example",
  capturedAt: "2026-08-07T12:00:00.000Z",
  destination: { kind: "landmark" as const, dir: "_content/reading" },
};
const first = await caller(box.root).share.saveTextual(request);
const saved = await readFile(path.join(box.root, first.created[0]), "utf-8");
print(saved.includes("sources:\n  - href: https://example.com/article\n    retrieved: 2026-08-07T12:00:00.000Z\n"));
print(saved.includes("share-id: 00000000-0000-4000-8000-000000000001"));
print(saved.includes("[An Example](https://example.com/article)"));
first.created[0].endsWith(".webpage.card")
=>
true
true
true
true
```

```ts continue
const moved = path.join("_content/inbox", path.basename(first.created[0]));
await mkdir(path.join(box.root, "_content/inbox"), { recursive: true });
await rename(path.join(box.root, first.created[0]), path.join(box.root, moved));
const replay = await caller(box.root).share.saveTextual(request);
replay.created[0]
=> _content/inbox/An_Example_00000000-0000-4000-8000-000000000001.webpage.card
```

## A retry against a card saved before the `sources` change is idempotent

A card the share router wrote with the old `source` and `captured` keys is
rewritten by the `source-fields-2026-09` migration before the new code serves.
The migrated card is byte-identical to the one the router now generates, so a
retry of that share still finds it instead of reporting a conflict:

```ts continue
const oldRequest = { ...request, shareId: "00000000-0000-4000-8000-000000000003", title: "Before" };
const oldCard = `---\n${stringify({
  title: "Before",
  source: oldRequest.url,
  captured: oldRequest.capturedAt,
  "share-id": oldRequest.shareId,
})}---\n[Before](${oldRequest.url})\n`;
const split = splitCardContent(oldCard);
const migrated = `---\n${applyFieldEdits(split.frontmatterText, planSourceFields("webpage", parse(split.frontmatterText)).edits)}---\n${split.body}`;
const oldRel = "_content/inbox/Before_00000000-0000-4000-8000-000000000003.webpage.card";
await writeFile(path.join(box.root, oldRel), migrated, "utf-8");
const retried = await caller(box.root).share.saveTextual(oldRequest);
retried.created[0] === oldRel
=> true
```

## A reused share id with different immutable content conflicts

```ts continue
const conflict = await caller(box.root).share.saveTextual({
  ...request,
  url: "https://different.example/",
}).then(() => "no-error", (error) => error.code);
conflict
=> CONFLICT
```

## A stale landmark selection is rejected instead of becoming Inbox

```ts continue
const stale = await caller(box.root).share.saveTextual({
  kind: "text",
  shareId: "00000000-0000-4000-8000-000000000002",
  text: "Keep this exact text",
  capturedAt: "2026-08-07T12:00:00.000Z",
  destination: { kind: "landmark", dir: "_content/missing" },
}).then(() => "no-error", (error) => error.code);
stale
=> BAD_REQUEST
```

```ts cleanup
await box.cleanup();
```

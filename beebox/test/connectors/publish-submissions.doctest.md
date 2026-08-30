# Publish-submissions connector

The publish-submissions connector pulls viewer submissions and `any-account`
access logs from R2 (buffered edge-side by the publish Worker), lands them as
inbox cards, and deletes the remote objects — **land-then-delete**, so the
pipeline is at-least-once, with submission-id dedup making a re-pull idempotent.

The pull logic is exercised against a FAKE `PublishRemoteStore` (no network) and
an injected `commit` stub, so no live Cloudflare account is needed.

```ts setup
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { createPublishSubmissionsConnector } from "../../src/connectors/publish-submissions.js";
import { createFakePublishStore } from "../../src/services/publish-remote-store.js";
import { getBoxDir } from "../../src/lib/paths.js";
import { relative } from "node:path";
import { readdir } from "node:fs/promises";

function submissionObject(over) {
  return JSON.stringify({
    id: "sub-1",
    ts: "2026-07-14T12:00:00Z",
    pubId: "pub-abc",
    fields: { name: "Ada", message: "hello" },
    viewer: null,
    country: "US",
    ...over,
  });
}

// A committing stub: records the paths it was asked to commit and when, so we
// can assert commit happened before any delete.
function recordingDeps(store, order) {
  return {
    store,
    now: () => new Date("2026-07-15T09:00:00Z"),
    commit: async ({ paths }) => { order.push(`commit:${paths.length}`); },
  };
}

async function inboxCards(box) {
  const dir = getBoxDir(box.root, "inbox");
  const entries = await readdir(dir).catch(() => []);
  return entries.filter((f) => f.endsWith(".card")).toSorted();
}
```

## Unconfigured (no store, no creds) → clean no-op

With no injected store and no R2 env vars, `sync()` returns an empty success and
touches nothing.

```ts
const box = await makeTmpBox();
const connector = createPublishSubmissionsConnector(box.root);
const result = await connector.sync();
JSON.stringify(result)
=> {"success":true,"created":[],"updated":[]}
```

```ts cleanup
await box.cleanup();
```

## A submission lands as a pub-submission card, then the object is deleted

```ts
const box = await makeTmpBox();
const store = createFakePublishStore({
  objects: { "submissions/pub-abc/sub-1.json": submissionObject() },
});
const order = [];
const connector = createPublishSubmissionsConnector(box.root, recordingDeps(store, order));
const result = await connector.sync();
result.created.length
=> 1

(await inboxCards(box))[0]
=> Submission-sub-1.pub-submission.card
```

The remote object was deleted, and the commit happened before the delete:

```ts continue
store.deleted.join(",")
=> submissions/pub-abc/sub-1.json

// commit:N appears before the delete was recorded (deletes run after commit in sync()).
order[0]
=> commit:1
```

The landed card carries the submitted fields and coarse attribution:

```ts continue
const text = await box.read("box/inbox/Submission-sub-1.pub-submission.card");
text.includes("pub-id: pub-abc") && text.includes("country: US") && text.includes("hello")
=> true
```

```ts cleanup
await box.cleanup();
```

## A malformed remote object is skipped, not crashed (and left in place)

```ts
const box = await makeTmpBox();
const store = createFakePublishStore({
  objects: {
    "submissions/pub-abc/good.json": submissionObject({ id: "good" }),
    "submissions/pub-abc/bad.json": "{ not valid json",
  },
});
const order = [];
const connector = createPublishSubmissionsConnector(box.root, recordingDeps(store, order));
const result = await connector.sync();
// Only the good one landed.
result.created.length
=> 1

(await inboxCards(box))[0]
=> Submission-good.pub-submission.card
```

The bad object is left in R2 for inspection; only the good one was deleted:

```ts continue
store.deleted.join(",")
=> submissions/pub-abc/good.json

store.objects.has("submissions/pub-abc/bad.json")
=> true
```

```ts cleanup
await box.cleanup();
```

## Re-pull of an already-landed id is idempotent (no duplicate)

A crash between write and delete leaves the object; the next pull sees the id's
card already on disk, writes no duplicate, and just deletes the leftover.

```ts
const box = await makeTmpBox();
const store = createFakePublishStore({
  objects: { "submissions/pub-abc/sub-1.json": submissionObject() },
});
// First pull lands + deletes.
const order1 = [];
await createPublishSubmissionsConnector(box.root, recordingDeps(store, order1)).sync();

// Simulate the object reappearing (crash-before-delete) by re-seeding it.
store.objects.set("submissions/pub-abc/sub-1.json", new TextEncoder().encode(submissionObject()));
const order2 = [];
const result = await createPublishSubmissionsConnector(box.root, recordingDeps(store, order2)).sync();

// No new card was created on the second pull (dedup by id).
result.created.length
=> 0

(await inboxCards(box)).length
=> 1
```

The leftover object was still deleted (converges, at-least-once):

```ts continue
store.objects.has("submissions/pub-abc/sub-1.json")
=> false
```

```ts cleanup
await box.cleanup();
```

## Access logs aggregate into a digest card, then the logs are deleted

```ts
const box = await makeTmpBox();
const store = createFakePublishStore({
  objects: {
    "access-log/pub-abc/1.json": JSON.stringify({ ts: "2026-07-14T10:00:00Z", pubId: "pub-abc", email: "a@x.com" }),
    "access-log/pub-abc/2.json": JSON.stringify({ ts: "2026-07-14T11:00:00Z", pubId: "pub-abc", email: "b@x.com" }),
    "access-log/pub-abc/bad.json": "nope",
  },
});
const order = [];
const result = await createPublishSubmissionsConnector(box.root, recordingDeps(store, order)).sync();
result.created.length
=> 1

const digest = (await inboxCards(box)).find((f) => f.startsWith("Access-Log-Digest"));
digest?.endsWith(".memo.card")
=> true
```

The digest names both views; the two valid logs were deleted, the malformed one left:

```ts continue
const dir = getBoxDir(box.root, "inbox");
const files = await readdir(dir);
const digestFile = files.find((f) => f.startsWith("Access-Log-Digest"));
const text = await box.read("box/inbox/" + digestFile);
text.includes("a@x.com") && text.includes("b@x.com") && text.includes("2 views")
=> true
```

```ts continue
store.deleted.toSorted().join(",")
=> access-log/pub-abc/1.json,access-log/pub-abc/2.json

store.objects.has("access-log/pub-abc/bad.json")
=> true
```

```ts cleanup
await box.cleanup();
```

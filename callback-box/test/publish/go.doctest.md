# `cb pub go` — the human flip

`goPublication` (Track E of `docs/plans/publish-pages.md`) is the key control:
the agent may draft, but only the human flips a publication live. It re-runs the
leak scan, requires an interactive confirmation, and uploads in the safe order
(bundle objects first, edge manifest last) so a publication is unreachable-then-
atomic, never half-served.

The confirmation is an injected seam. The doctests drive it non-interactively by
injecting a stub; the DEFAULT confirm is a real TTY prompt that REFUSES when
stdin is not a terminal (the never-auto-flip guarantee), which these tests also
exercise by omitting the stub.

```ts setup
import { draftPublication } from "../../src/publish/draft.js";
import { goPublication } from "../../src/publish/go.js";
import { createFakePublishStore } from "../../src/services/publish-remote-store.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const now = new Date("2026-07-14T12:00:00Z");
const noopCommit = async () => {};
// This test explicitly exercises the non-interactive refusal path.
process.stdin.isTTY = false;

function draftCtx() {
  return { now, ownerEmail: "owner@box.test", softwareVersion: "1.0.0", commit: noopCommit };
}

async function draft(box, source, opts) {
  const r = await draftPublication({ boxRoot: box.root, source, ...opts }, draftCtx());
  if (!r.ok) throw new Error("draft setup failed: " + r.reason + " " + (r.message ?? ""));
  return r.pubId;
}
```

## On confirm: bundle objects upload BEFORE the manifest; slug pointer; live + committed

```ts
const box = await makeTmpBox();
await box.write("docs/j.md", "# J\n\nA clean note.\n");
const pubId = await draft(box, "docs/j.md", { tier: "public", slug: "jay" });

const store = createFakePublishStore();
const committed = [];
const result = await goPublication(
  { boxRoot: box.root, pubId },
  { store, ownerEmail: "owner@box.test", confirm: async () => true, commit: async (a) => committed.push(a.pubId) },
);
result.ok
=> true

[result.uploadedBundleObjects, result.slugPointer].join(" ")
=> 1 true
```

The upload order is the proof of the atomic-ish guarantee: every bundle object
was PUT before the edge manifest, and the public-tier slug pointer went last.

```ts continue
const manifestIdx = store.puts.findIndex((k) => k.endsWith("/manifest.json"));
const bundleIdx = store.puts.findIndex((k) => k.includes("/bundle/"));
bundleIdx >= 0 && bundleIdx < manifestIdx
=> true

store.puts[store.puts.length - 1].startsWith("slugs/")
=> true
```

The edge manifest and the local manifest are both `live`, and the flip was
committed exactly once:

```ts continue
JSON.parse(new TextDecoder().decode(store.objects.get(`pubs/${pubId}/manifest.json`))).status
=> live

JSON.parse(await box.read(`box/publish/${pubId}/manifest.json`)).status
=> live

JSON.stringify(committed) === JSON.stringify([pubId])
=> true

await box.cleanup();
```

## Without a TTY and no injected confirm, it REFUSES — never auto-flips

The default confirm sees a non-terminal stdin and declines; nothing is uploaded
and the local manifest stays a draft.

```ts
const box = await makeTmpBox();
await box.write("docs/j.md", "# J\n\nbody\n");
const pubId = await draft(box, "docs/j.md", { tier: "secret" });

const store = createFakePublishStore();
const result = await goPublication({ boxRoot: box.root, pubId }, { store, ownerEmail: null, commit: noopCommit });
result.ok
=> false

result.reason
=> not-confirmed

store.puts.length
=> 0

JSON.parse(await box.read(`box/publish/${pubId}/manifest.json`)).status
=> draft

await box.cleanup();
```

## Refuses a non-draft (already live)

```ts
const box = await makeTmpBox();
await box.write("docs/j.md", "# J\n\nbody\n");
const pubId = await draft(box, "docs/j.md", { tier: "secret" });

const store = createFakePublishStore();
const goDeps = { store, ownerEmail: null, confirm: async () => true, commit: noopCommit };
await goPublication({ boxRoot: box.root, pubId }, goDeps);

const second = await goPublication({ boxRoot: box.root, pubId }, goDeps);
second.ok
=> false

second.reason
=> not-draft

second.status
=> live

await box.cleanup();
```

## Refuses on unaccepted leak findings (same gate as draft) — before any upload

A blocked draft leaves an uncommitted draft on disk (status draft, no accepted
leaks). `go` re-scans, finds the unaccepted leak, and refuses before the confirm
or any upload.

```ts
const box = await makeTmpBox();
const secret = "AIza" + "a".repeat(35);
await box.write("docs/leaky.md", `# Leaky\n\nkey ${secret} here\n`);
const blocked = await draftPublication({ boxRoot: box.root, source: "docs/leaky.md", tier: "secret" }, draftCtx());
blocked.ok
=> false

const store = createFakePublishStore();
const result = await goPublication(
  { boxRoot: box.root, pubId: blocked.pubId },
  { store, ownerEmail: null, confirm: async () => true, commit: noopCommit },
);
result.ok
=> false

result.reason
=> leaks-blocked

result.blocking.length
=> 1

store.puts.length
=> 0

await box.cleanup();
```

## Re-running after a partial upload is idempotent

A prior `go` that uploaded some bundle objects but crashed before the manifest
leaves the local manifest a draft. Re-running re-puts everything (a put is an
overwrite), lands the manifest, and flips live.

```ts
const box = await makeTmpBox();
await box.write("docs/j.md", "# J\n\nreal body\n");
const pubId = await draft(box, "docs/j.md", { tier: "secret" });

// Simulate the partial prior upload: a stale bundle object, no manifest yet.
const objects = {};
objects[`pubs/${pubId}/bundle/index.html`] = "stale partial";
const store = createFakePublishStore({ objects });

const result = await goPublication(
  { boxRoot: box.root, pubId },
  { store, ownerEmail: null, confirm: async () => true, commit: noopCommit },
);
result.ok
=> true

// The manifest is now present and live.
JSON.parse(new TextDecoder().decode(store.objects.get(`pubs/${pubId}/manifest.json`))).status
=> live

// The stale bundle object was overwritten with the real render.
new TextDecoder().decode(store.objects.get(`pubs/${pubId}/bundle/index.html`)).includes("real body")
=> true

await box.cleanup();
```

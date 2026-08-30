# `bbx pub ls` and `bbx pub revoke`

The publication-lifecycle core (Track E of `docs/plans/publish-pages.md`):
`listPublications` reads the box's local manifests (read-only, no Cloudflare),
and `revokePublication` tombstones a publication edge-side (the ONE fail-close
action — pages and submit die together) before best-effort-deleting its bundle.

Both are exercised against a FAKE `PublishRemoteStore` (no network) with injected
commit stubs, so no real git repo or Cloudflare account is needed. Drafts are
created with `draftPublication` (which writes the bundle + manifest to disk).

```ts setup
import { draftPublication } from "../../src/publish/draft.js";
import { goPublication } from "../../src/publish/go.js";
import { listPublications, revokePublication } from "../../src/publish/lifecycle.js";
import { createFakePublishStore } from "../../src/services/publish-remote-store.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const now = new Date("2026-07-14T12:00:00Z");
const noopCommit = async () => {};

function draftCtx() {
  return { now, ownerEmail: "owner@box.test", softwareVersion: "1.0.0", commit: noopCommit };
}

// Draft a docs source to disk and return its (validated) pub-id.
async function draft(box, source, opts) {
  const r = await draftPublication({ boxRoot: box.root, source, ...opts }, draftCtx());
  if (!r.ok) throw new Error("draft setup failed: " + r.reason + " " + (r.message ?? ""));
  return r.pubId;
}
```

## `ls` lists drafts, a live, and a revoked publication with tier/status/source

```ts
const box = await makeTmpBox();
await box.write("docs/a.md", "# A\n\nbody a\n");
await box.write("docs/b.md", "# B\n\nbody b\n");
await box.write("docs/c.md", "# C\n\nbody c\n");

const draftId = await draft(box, "docs/a.md", { tier: "public", slug: "alpha" });
const liveId = await draft(box, "docs/b.md", { tier: "secret" });
const revokedId = await draft(box, "docs/c.md", { tier: "accounts", emails: ["viewer@x.com"] });

// Flip two live, then revoke one — all through the fake store.
const store = createFakePublishStore();
const goDeps = { store, ownerEmail: "owner@box.test", confirm: async () => true, commit: noopCommit };
await goPublication({ boxRoot: box.root, pubId: liveId }, goDeps);
await goPublication({ boxRoot: box.root, pubId: revokedId }, goDeps);
await revokePublication({ boxRoot: box.root, pubId: revokedId }, { store, commit: noopCommit });

const summaries = await listPublications(box.root);
summaries.length
=> 3
```

Each publication reports its current status, and the fields specific to its tier:

```ts continue
const byId = Object.fromEntries(summaries.map((s) => [s.pubId, s.status]));
[byId[draftId], byId[liveId], byId[revokedId]].join(",")
=> draft,live,revoked

// Public tier: slug + source ref from provenance.
const pub = summaries.find((s) => s.pubId === draftId);
[pub.tier, pub.slug, pub.source].join(" ")
=> public alpha docs/a.md

// Accounts tier: the viewer allowlist.
const acct = summaries.find((s) => s.pubId === revokedId);
JSON.stringify(acct.allowedEmails)
=> ["viewer@x.com"]

await box.cleanup();
```

## A box with no publications lists empty

```ts
const box = await makeTmpBox();
(await listPublications(box.root)).length
=> 0

await box.cleanup();
```

## `revoke` writes the tombstone FIRST, then deletes bundle + slug best-effort

The tombstone (revoked edge manifest) PUT lands before any bundle delete, so a
revoked publication fail-closes even if the deletes never run.

```ts
const box = await makeTmpBox();
await box.write("docs/j.md", "# J\n\nbody\n");
const pubId = await draft(box, "docs/j.md", { tier: "public", slug: "jay" });

// Seed the store as if this pub were already live (bundle + manifest + slug).
const objects = {};
objects[`pubs/${pubId}/manifest.json`] = JSON.stringify({ tier: "public", status: "live" });
objects[`pubs/${pubId}/bundle/index.html`] = "<html>live</html>";
objects["slugs/jay"] = pubId;
const store = createFakePublishStore({ objects });

const committed = [];
const result = await revokePublication(
  { boxRoot: box.root, pubId },
  { store, commit: async (a) => committed.push(a.pubId) },
);
result.ok
=> true

// The FIRST mutating op was the manifest PUT (the tombstone) — before any delete.
store.ops[0].startsWith("put:") && store.ops[0].includes("/manifest.json")
=> true

store.ops.slice(1).every((o) => o.startsWith("delete:"))
=> true
```

The uploaded manifest is the revoked edge manifest, the bundle + slug were
deleted, and the local manifest was committed as revoked:

```ts continue
const uploaded = new TextDecoder().decode(store.objects.get(`pubs/${pubId}/manifest.json`));
JSON.parse(uploaded).status
=> revoked

[result.deletedBundleObjects, result.deletedSlug].join(" ")
=> 1 true

JSON.parse(await box.read(`box/publish/${pubId}/manifest.json`)).status
=> revoked

JSON.stringify(committed) === JSON.stringify([pubId])
=> true

await box.cleanup();
```

## `revoke` with no configured store fails with a clear, fix-naming error

```ts
const box = await makeTmpBox();
await box.write("docs/j.md", "# J\n\nbody\n");
const pubId = await draft(box, "docs/j.md", { tier: "secret" });

const result = await revokePublication({ boxRoot: box.root, pubId }, { store: null });
result.ok
=> false

result.reason
=> unconfigured

result.message.includes("bbx pub setup")
=> true

await box.cleanup();
```

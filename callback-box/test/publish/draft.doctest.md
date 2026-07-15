# `cb pub draft` core

`draftPublication` (Track E of `docs/plans/publish-pages.md`) renders a docs
source into a `box/publish/<pub-id>/` draft (via the box layout), writes the bundle + manifest to the
working tree, runs the leak scan, and commits **only** on a clean-or-accepted
scan. The commit step is injectable, so these filesystem doctests exercise the
render→write→scan→decision logic with a recording stub — no real git repo
needed.

```ts setup
import { draftPublication } from "../../src/publish/draft.js";
import { publicationManifestSchema } from "../../src/publish/manifest.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const now = new Date("2026-07-14T12:00:00Z");

// A recording commit stub — captures which pub-ids were committed, so a test
// can assert the git-commit discipline without a repo.
function makeCtx(committed) {
  return {
    now,
    ownerEmail: "owner@box.test",
    softwareVersion: "1.0.0",
    commit: async (args) => {
      committed.push(args.pubId);
    },
  };
}
```

## A clean docs source drafts, writes, and commits

The manifest validates, provenance is machine-filled by the renderer, the bundle
is on disk, and the draft was committed (scan was clean).

```ts
const box = await makeTmpBox();
await box.write("docs/journal.md", "# Build Journal\n\nA clean note, nothing sensitive.\n");

const committed = [];
const result = await draftPublication(
  { boxRoot: box.root, source: "docs/journal.md", tier: "public", slug: "journal" },
  makeCtx(committed),
);

result.ok
=> true

// Provenance is machine-filled, not agent-typed.
result.manifest.provenance.renderer
=> docs

JSON.stringify(result.manifest.provenance.sourceRefs)
=> ["docs/journal.md"]

result.manifest.provenance.renderedAt
=> 2026-07-14T12:00:00.000Z

result.manifest.provenance.softwareVersion
=> 1.0.0

result.manifest.status
=> draft
```

The manifest and bundle are written under `box/publish/<pub-id>/` (a sibling of
`box/inbox/`, resolved via the box layout), the persisted manifest re-validates,
and the clean scan led to exactly one commit.

```ts continue
const manifestRaw = await box.read(`box/publish/${result.pubId}/manifest.json`);
publicationManifestSchema.safeParse(JSON.parse(manifestRaw)).success
=> true

// The bundle entry is present and previewed with bytes + sha256.
(await box.read(`box/publish/${result.pubId}/bundle/index.html`)).includes("Build Journal")
=> true

result.files.some((f) => f.path === "index.html" && f.bytes > 0 && /^[\da-f]{64}$/.test(f.sha256))
=> true

// Clean scan ⇒ committed exactly once, for this pub-id.
JSON.stringify(committed) === JSON.stringify([result.pubId])
=> true

await box.cleanup();
```

## A bad flag combination is rejected with a clear, fix-naming message

`--slug` is public-tier only; the strict discriminated union makes "secret +
slug" unrepresentable, and the pre-check turns that into guidance.

```ts
const box = await makeTmpBox();
await box.write("docs/journal.md", "# Doc\n\nBody.\n");

const committed = [];
const bad = await draftPublication(
  { boxRoot: box.root, source: "docs/journal.md", tier: "secret", slug: "nope" },
  makeCtx(committed),
);

bad.ok
=> false

bad.reason
=> invalid-flags

bad.message.includes("slug") && bad.message.includes("public")
=> true

// Nothing committed on a rejected draft.
committed.length
=> 0

await box.cleanup();
```

## A planted secret blocks the draft until it is accepted by id

The scan blocks the commit (the secret never enters git history). Re-running with
`--accept-leak <id>` for the finding lets it through and records the acceptance
in provenance. The finding id is stable across the two runs (same kind+file+match).

```ts
const box = await makeTmpBox();
const secret = "AIza" + "a".repeat(35);
await box.write("docs/leaky.md", `# Leaky\n\nOops the key is ${secret} here.\n`);

const committed = [];
const blocked = await draftPublication(
  { boxRoot: box.root, source: "docs/leaky.md", tier: "secret" },
  makeCtx(committed),
);

blocked.ok
=> false

blocked.reason
=> leaks-blocked

blocked.blocking.length
=> 1

// Blocked ⇒ no commit yet.
committed.length
=> 0
```

Accepting the finding by its id lets the draft through and records it in
provenance.

```ts continue
const acceptId = blocked.blocking[0].id;
const accepted = await draftPublication(
  { boxRoot: box.root, source: "docs/leaky.md", tier: "secret", acceptLeaks: [acceptId] },
  makeCtx(committed),
);

accepted.ok
=> true

JSON.stringify(accepted.manifest.provenance.acceptedLeaks)
=> [«*»]

accepted.manifest.provenance.acceptedLeaks[0] === acceptId
=> true

// The accepted draft committed exactly once.
committed.length
=> 1

await box.cleanup();
```

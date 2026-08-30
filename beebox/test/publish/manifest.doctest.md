# Publication manifest

The manifest is the vocabulary Track A locks onto (`docs/plans/publish-pages.md`).
These examples exercise its guarantees: pub-id shape, per-tier parsing, the
discriminated-union rejections that make illegal states unrepresentable, and the
`toEdgeManifest` projection that strips every box identifier.

```ts setup
import {
  generatePubId,
  pubIdSchema,
  publicationManifestSchema,
  toEdgeManifest,
} from "../../src/publish/manifest.js";

// A reusable set of common fields for building manifest fixtures. Shared by the
// tier examples below so each stays focused on its tier-specific field.
const pubId = pubIdSchema.parse("abcdefghijklmnop2345672345");
const provenance = {
  boxSlug: "atlas",
  renderedAt: "2026-07-14T12:00:00Z",
  sourceRefs: ["box/docs/build-journal.md"],
  renderer: "docs",
  softwareVersion: "1.2.3",
};
const files = { "index.html": { bytes: 1234, sha256: "deadbeef" } };
const common = { pubId, status: "live", expiresAt: null, provenance, files };
```

## `generatePubId` produces a value the schema accepts

The id is 26 base32 characters, and two calls differ (128 bits of entropy make a
collision cryptographically impossible). We assert shape, not the random value.

```ts
const id = generatePubId();
id.length
=> 26

pubIdSchema.safeParse(id).success
=> true

generatePubId() === generatePubId()
=> false
```

A malformed id (uppercase, wrong length, out-of-alphabet) is rejected.

```ts
pubIdSchema.safeParse("TOO-SHORT").success
=> false
```

## A valid manifest of each tier parses

`public` may carry a human slug.

```ts
publicationManifestSchema.safeParse({ tier: "public", slug: "build-journal", ...common }).success
=> true
```

`secret` may carry a submit block.

```ts
const submit = {
  fields: [{ name: "note", kind: "textarea", required: true, maxLength: 2000 }],
  maxSubmissionBytes: 8192,
  maxPerDay: 20,
};
publicationManifestSchema.safeParse({ tier: "secret", submit, ...common }).success
=> true
```

`accounts` carries an allowlist.

```ts
publicationManifestSchema.safeParse({ tier: "accounts", allowedEmails: ["ada@example.com"], ...common }).success
=> true
```

`any-account` gates on any signed-in account.

```ts
publicationManifestSchema.safeParse({ tier: "any-account", ...common }).success
=> true
```

## Illegal tier/field combinations are rejected, not silently stripped

`.strict()` turns each "MUST NOT carry X" into a runtime rejection: an
out-of-tier field is an unknown key. `public` + `submit` fails.

```ts
const badSubmit = {
  fields: [{ name: "note", kind: "text", required: false, maxLength: 100 }],
  maxSubmissionBytes: 1024,
  maxPerDay: 5,
};
publicationManifestSchema.safeParse({ tier: "public", submit: badSubmit, ...common }).success
=> false
```

`public` + `allowedEmails` fails.

```ts
publicationManifestSchema.safeParse({ tier: "public", allowedEmails: ["ada@example.com"], ...common }).success
=> false
```

`secret` + `slug` fails.

```ts
publicationManifestSchema.safeParse({ tier: "secret", slug: "leak", ...common }).success
=> false
```

`accounts` + `slug` fails.

```ts
publicationManifestSchema.safeParse({ tier: "accounts", slug: "leak", allowedEmails: [], ...common }).success
=> false
```

## An `accounts` pub with an empty allowlist parses (empty = nobody)

Empty/absent `allowedEmails` is a Worker-side fail-closed rule, not a schema
rejection — the schema accepts it.

```ts
publicationManifestSchema.safeParse({ tier: "accounts", allowedEmails: [], ...common }).success
=> true
```

## `toEdgeManifest` drops provenance and box identifiers, keeps serve/gate fields

The edge subset the Worker sees carries only what serving needs. Provenance,
source refs, the box slug, and the pub-id must not appear.

```ts
const full = publicationManifestSchema.parse({
  tier: "accounts",
  allowedEmails: ["ada@example.com"],
  submit: {
    fields: [{ name: "reply", kind: "text", required: true, maxLength: 500 }],
    maxSubmissionBytes: 4096,
    maxPerDay: 10,
  },
  ...common,
});
const edge = toEdgeManifest(full);
Object.keys(edge).sort().join(",")
=> allowedEmails,expiresAt,files,status,submit,tier

"provenance" in edge
=> false

"pubId" in edge
=> false
```

The kept fields carry through unchanged.

```ts continue
JSON.stringify(edge.allowedEmails)
=> ["ada@example.com"]

edge.tier
=> accounts

edge.files
=> {
  "index.html": {
    "bytes": 1234,
    "sha256": "deadbeef"
  }
}
```

A `public` pub's slug survives the projection; nothing box-side leaks.

```ts
const edgePublic = toEdgeManifest(publicationManifestSchema.parse({ tier: "public", slug: "build-journal", ...common }));
edgePublic.slug
=> build-journal

Object.keys(edgePublic).sort().join(",")
=> expiresAt,files,slug,status,tier
```

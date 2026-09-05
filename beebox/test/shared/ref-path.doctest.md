# Ref path algebra

`src/shared/ref-path.ts` is THE home for turning a ref — an in-box pointer written in a card, a view, or a markdown link — into a box-relative path. Backend (`core/ref-exists.ts`) and frontend (`frontend/src/lib/view-url.ts`) share this one implementation, so a ref means the same thing on both sides.

```ts setup
import { parseRef, resolveRefPath } from "../../src/shared/ref-path.js";
```

## parseRef

A ref may carry a `?query` (a viewer selection like `?view=ledger`) and a `#fragment` (a location *within* the target). Both are split off the path, which is the only part that addresses a file:

```ts
JSON.stringify(parseRef("_content/notes/Plan.doc.card"))
=> {"path":"_content/notes/Plan.doc.card"}

JSON.stringify(parseRef("_content/x.bill.card?view=ledger"))
=> {"path":"_content/x.bill.card","query":"view=ledger"}

JSON.stringify(parseRef("_content/notes/Plan.doc.card#risks"))
=> {"path":"_content/notes/Plan.doc.card","fragment":"risks"}

JSON.stringify(parseRef("_content/x.bill.card?view=ledger#line-7"))
=> {"path":"_content/x.bill.card","query":"view=ledger","fragment":"line-7"}
```

The split is lossless — path, query, and fragment cover the whole input, so a consumer that rewrites the path can put the ref back together:

```ts
const ref = "_content/x.bill.card?view=ledger#line-7";
const parts = parseRef(ref);
const rebuilt = `${parts.path}${parts.query === undefined ? "" : `?${parts.query}`}${parts.fragment === undefined ? "" : `#${parts.fragment}`}`;
rebuilt === ref
=> true
```

Following URL convention, the fragment starts at the FIRST `#` and runs to the end, so a `?` inside it is fragment text, not a query:

```ts
JSON.stringify(parseRef("notes.md#a?b"))
=> {"path":"notes.md","fragment":"a?b"}
```

A bare fragment has an empty path (it addresses the current document), and a ref with no `?`/`#` comes back untouched:

```ts
JSON.stringify(parseRef("#risks"))
=> {"path":"","fragment":"risks"}
```

## resolveRefPath — the 3-form rule

**Form 1 — leading `/` is box-root-absolute**, and ignores the referring document entirely:

```ts
resolveRefPath({ fromPath: "_content/docs/tax/2023/return.md", ref: "/_content/Foo.memo.card", kind: "card" })
=> _content/Foo.memo.card
```

**Form 2 — `attach/…` is the referring card's own attach scope** (`<basename>.attach/`), the one deliberate exception to box-root addressing. A bare `attach` names the directory itself, and subdirectories inside the scope work:

```ts
resolveRefPath({ fromPath: "_content/inbox/Trip.record.card", ref: "attach/photo-001.jpg", kind: "card" })
=> _content/inbox/Trip.attach/photo-001.jpg

resolveRefPath({ fromPath: "_content/inbox/Trip.record.card", ref: "attach", kind: "card" })
=> _content/inbox/Trip.attach

resolveRefPath({ fromPath: "_content/inbox/Trip.record.card", ref: "attach/sub/dir/scan.image.card", kind: "card" })
=> _content/inbox/Trip.attach/sub/dir/scan.image.card
```

**Form 3 — anything else is relative to the referring document's directory**, filesystem-style (`.` and a contained `..` both work):

```ts
resolveRefPath({ fromPath: "_content/docs/tax/2023/return.md", ref: "1040.pdf", kind: "markdown" })
=> _content/docs/tax/2023/1040.pdf

resolveRefPath({ fromPath: "_content/docs/tax/2023/return.md", ref: "../2022/summary.md", kind: "markdown" })
=> _content/docs/tax/2022/summary.md

resolveRefPath({ fromPath: "_content/docs/tax/2023/return.md", ref: "./notes.md", kind: "markdown" })
=> _content/docs/tax/2023/notes.md
```

`fromPath` is treated as a containing *file* — its last segment is stripped. A directory base (a chat's working directory, say) must carry a trailing slash so the strip is a no-op:

```ts
JSON.stringify([
  resolveRefPath({ fromPath: "_content/foo/x.md", ref: "bar.card", kind: "markdown" }),
  resolveRefPath({ fromPath: "_content/foo/", ref: "bar.card", kind: "markdown" }),
])
=> ["_content/foo/bar.card","_content/foo/bar.card"]
```

An empty or absent `fromPath` resolves from the box root — which is itself outside the box namespace (there are no ref-addressable root files), so a bare relative ref with no `fromPath` only resolves when it happens to name an area:

```ts
resolveRefPath({ fromPath: undefined, ref: "_content/notes.md", kind: "markdown" })
=> _content/notes.md

resolveRefPath({ fromPath: undefined, ref: "notes.md", kind: "markdown" })
=> null

resolveRefPath({ fromPath: "", ref: "_content/notes.md", kind: "markdown" })
=> _content/notes.md
```

## RefKind — who owns an attach scope

Only a `card` owns a `<basename>.attach/` scope. In a plain `.md` dossier (`markdown`) — or a path a command is about to write (`write-target`) — `attach/` is a literal relative directory, not the virtual prefix:

```ts
JSON.stringify([
  resolveRefPath({ fromPath: "_content/dossiers/annika.md", ref: "attach/photo.jpg", kind: "card" }),
  resolveRefPath({ fromPath: "_content/dossiers/annika.md", ref: "attach/photo.jpg", kind: "markdown" }),
  resolveRefPath({ fromPath: "_content/dossiers/annika.md", ref: "attach/photo.jpg", kind: "write-target" }),
])
=> ["_content/dossiers/annika.md.attach/photo.jpg","_content/dossiers/attach/photo.jpg","_content/dossiers/attach/photo.jpg"]
```

The prefix is only meaningful as the first segment — a mid-path `.attach/` is an ordinary directory name, and a card at an area's own root gets its scope there:

```ts
resolveRefPath({ fromPath: "_content/inbox/Job.card", ref: "/_content/Trip.attach/photo.jpg", kind: "card" })
=> _content/Trip.attach/photo.jpg

resolveRefPath({ fromPath: "_content/Trip.record.card", ref: "attach/photo.jpg", kind: "card" })
=> _content/Trip.attach/photo.jpg
```

## Escapes fail closed

A `..` that climbs above the box root returns `null` — everywhere, in every consumer. It is never clamped back to the root, because clamping silently resolves to a *different* file than the ref named. `null` means "broken ref"; callers degrade visibly.

```ts
JSON.stringify(resolveRefPath({ fromPath: "_content/inbox/Job.card", ref: "../../../../etc/passwd", kind: "card" }))
=> null

JSON.stringify(resolveRefPath({ fromPath: "_content/Job.card", ref: "..", kind: "card" }))
=> null
```

A leading slash is box-root-absolute, but `..` still can't climb out of it:

```ts
JSON.stringify(resolveRefPath({ fromPath: "_content/Job.card", ref: "/../etc/passwd", kind: "card" }))
=> null

JSON.stringify(resolveRefPath({ fromPath: "_content/inbox/Job.card", ref: "attach/../../../escape.txt", kind: "card" }))
=> null
```

A `..` that stays inside the box is fine — only leaving is refused:

```ts
resolveRefPath({ fromPath: "_content/inbox/Job.card", ref: "../store/x.card", kind: "card" })
=> _content/store/x.card
```

Refs are filesystem-style paths, never percent-encoded, so `%2e%2e` is a LITERAL directory name — decoding it here would manufacture traversal:

```ts
resolveRefPath({ fromPath: "_content/inbox/Job.card", ref: "%2e%2e/x.card", kind: "card" })
=> _content/inbox/%2e%2e/x.card
```

## A ref that names nothing fails closed too

A ref addresses a *file*. An empty ref names no file, and neither does one that
resolves to the box root itself — both return `null` rather than the containing
directory, which every existence check would have accepted. This is what stops a
fragment- or query-only ref (`#risks`, `?view=x`, whose path part parses away)
from reading as a valid target.

```ts
JSON.stringify(resolveRefPath({ fromPath: "_content/inbox/Job.card", ref: "", kind: "card" }))
=> null

JSON.stringify(resolveRefPath({ fromPath: "_content/inbox/Job.card", ref: parseRef("#risks").path, kind: "card" }))
=> null

JSON.stringify(resolveRefPath({ fromPath: "_content/inbox/Job.card", ref: "/", kind: "card" }))
=> null
```

A ref to an ordinary directory still resolves — only the root is refused, because
an empty box-relative path is not a target a caller can act on:

```ts
resolveRefPath({ fromPath: "_content/inbox/Job.card", ref: "../store", kind: "card" })
=> _content/store
```

## Query and fragment are the caller's to split

`resolveRefPath` resolves a *path*; it does not parse `?`/`#`. Run the raw ref through `parseRef` first — this is what stops a `path#fragment` ref (e.g. `feedback.target.ref`) from being checked against the filesystem with its fragment attached:

```ts
const raw = "/_content/Plan.doc.card#risks";
resolveRefPath({ fromPath: "_content/inbox/Job.card", ref: parseRef(raw).path, kind: "card" })
=> _content/Plan.doc.card
```

## The box namespace fence

A resolved ref must land inside an underscore area — `_content`, `_config`, `_bookkeeping`, `_publish`, `_tmp` — or it resolves to `null`, fail-closed exactly like the `..`-escape rule above. Every area resolves:

```ts
JSON.stringify([
  resolveRefPath({ fromPath: undefined, ref: "/_content/Foo.card", kind: "card" }),
  resolveRefPath({ fromPath: undefined, ref: "/_config/box.json", kind: "card" }),
  resolveRefPath({ fromPath: undefined, ref: "/_bookkeeping/jobs/x.job.card", kind: "card" }),
  resolveRefPath({ fromPath: undefined, ref: "/_publish/site-1/manifest.json", kind: "card" }),
  resolveRefPath({ fromPath: undefined, ref: "/_tmp/upload.png", kind: "card" }),
])
=> ["_content/Foo.card","_config/box.json","_bookkeeping/jobs/x.job.card","_publish/site-1/manifest.json","_tmp/upload.png"]
```

Everything outside the underscore vocabulary is refused — the npm namespace, `.git/`, box code, agent identity, spec'd root files, and any unlisted root name alike:

```ts
JSON.stringify([
  resolveRefPath({ fromPath: undefined, ref: "/src/tricks/scripts/x.ts", kind: "card" }),
  resolveRefPath({ fromPath: undefined, ref: "/node_modules/x/index.js", kind: "card" }),
  resolveRefPath({ fromPath: undefined, ref: "/.git/config", kind: "card" }),
  resolveRefPath({ fromPath: undefined, ref: "/package.json", kind: "card" }),
  resolveRefPath({ fromPath: undefined, ref: "/CLAUDE.md", kind: "card" }),
  resolveRefPath({ fromPath: undefined, ref: "/.claude/settings.json", kind: "card" }),
  resolveRefPath({ fromPath: undefined, ref: "/some-unlisted-root-name/x", kind: "card" }),
])
=> [null,null,null,null,null,null,null]
```

The fence applies uniformly across all three forms — a relative ref that would otherwise resolve fine still fails if the result lands outside the namespace (e.g. a card at the box root, addressed relative to itself, reaching for a sibling that isn't under an area):

```ts
JSON.stringify(resolveRefPath({ fromPath: "package.json", ref: "CLAUDE.md", kind: "write-target" }))
=> null
```

# Ref path algebra

`src/shared/ref-path.ts` is THE home for turning a ref — an in-box pointer written in a card, a view, or a markdown link — into a box-relative path. Backend (`core/ref-exists.ts`) and frontend (`frontend/src/lib/view-url.ts`) share this one implementation, so a ref means the same thing on both sides.

```ts setup
import { parseRef, resolveRefPath } from "../../src/shared/ref-path.js";
```

## parseRef

A ref may carry a `?query` (a viewer selection like `?view=ledger`) and a `#fragment` (a location *within* the target). Both are split off the path, which is the only part that addresses a file:

```ts
JSON.stringify(parseRef("store/notes/Plan.doc.card"))
=> {"path":"store/notes/Plan.doc.card"}

JSON.stringify(parseRef("store/x.bill.card?view=ledger"))
=> {"path":"store/x.bill.card","query":"view=ledger"}

JSON.stringify(parseRef("store/notes/Plan.doc.card#risks"))
=> {"path":"store/notes/Plan.doc.card","fragment":"risks"}

JSON.stringify(parseRef("store/x.bill.card?view=ledger#line-7"))
=> {"path":"store/x.bill.card","query":"view=ledger","fragment":"line-7"}
```

The split is lossless — path, query, and fragment cover the whole input, so a consumer that rewrites the path can put the ref back together:

```ts
const ref = "store/x.bill.card?view=ledger#line-7";
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
resolveRefPath({ fromPath: "store/docs/tax/2023/return.md", ref: "/store/Foo.memo.card", kind: "card" })
=> store/Foo.memo.card
```

**Form 2 — `attach/…` is the referring card's own attach scope** (`<basename>.attach/`), the one deliberate exception to box-root addressing. A bare `attach` names the directory itself, and subdirectories inside the scope work:

```ts
resolveRefPath({ fromPath: "inbox/Trip.record.card", ref: "attach/photo-001.jpg", kind: "card" })
=> inbox/Trip.attach/photo-001.jpg

resolveRefPath({ fromPath: "inbox/Trip.record.card", ref: "attach", kind: "card" })
=> inbox/Trip.attach

resolveRefPath({ fromPath: "inbox/Trip.record.card", ref: "attach/sub/dir/scan.image.card", kind: "card" })
=> inbox/Trip.attach/sub/dir/scan.image.card
```

**Form 3 — anything else is relative to the referring document's directory**, filesystem-style (`.` and a contained `..` both work):

```ts
resolveRefPath({ fromPath: "store/docs/tax/2023/return.md", ref: "1040.pdf", kind: "markdown" })
=> store/docs/tax/2023/1040.pdf

resolveRefPath({ fromPath: "store/docs/tax/2023/return.md", ref: "../2022/summary.md", kind: "markdown" })
=> store/docs/tax/2022/summary.md

resolveRefPath({ fromPath: "store/docs/tax/2023/return.md", ref: "./notes.md", kind: "markdown" })
=> store/docs/tax/2023/notes.md
```

`fromPath` is treated as a containing *file* — its last segment is stripped. A directory base (a chat's working directory, say) must carry a trailing slash so the strip is a no-op:

```ts
JSON.stringify([
  resolveRefPath({ fromPath: "store/foo/x.md", ref: "bar.card", kind: "markdown" }),
  resolveRefPath({ fromPath: "store/foo/", ref: "bar.card", kind: "markdown" }),
])
=> ["store/foo/bar.card","store/foo/bar.card"]
```

An empty or absent `fromPath` resolves from the box root:

```ts
resolveRefPath({ fromPath: undefined, ref: "notes.md", kind: "markdown" })
=> notes.md

resolveRefPath({ fromPath: "", ref: "store/notes.md", kind: "markdown" })
=> store/notes.md
```

## RefKind — who owns an attach scope

Only a `card` owns a `<basename>.attach/` scope. In a plain `.md` dossier (`markdown`) — or a path a command is about to write (`write-target`) — `attach/` is a literal relative directory, not the virtual prefix:

```ts
JSON.stringify([
  resolveRefPath({ fromPath: "store/dossiers/annika.md", ref: "attach/photo.jpg", kind: "card" }),
  resolveRefPath({ fromPath: "store/dossiers/annika.md", ref: "attach/photo.jpg", kind: "markdown" }),
  resolveRefPath({ fromPath: "store/dossiers/annika.md", ref: "attach/photo.jpg", kind: "write-target" }),
])
=> ["store/dossiers/annika.md.attach/photo.jpg","store/dossiers/attach/photo.jpg","store/dossiers/attach/photo.jpg"]
```

The prefix is only meaningful as the first segment — a mid-path `.attach/` is an ordinary directory name, and a card at the box root gets its scope at the root:

```ts
resolveRefPath({ fromPath: "inbox/Job.card", ref: "/store/Trip.attach/photo.jpg", kind: "card" })
=> store/Trip.attach/photo.jpg

resolveRefPath({ fromPath: "Trip.record.card", ref: "attach/photo.jpg", kind: "card" })
=> Trip.attach/photo.jpg
```

## Escapes fail closed

A `..` that climbs above the box root returns `null` — everywhere, in every consumer. It is never clamped back to the root, because clamping silently resolves to a *different* file than the ref named. `null` means "broken ref"; callers degrade visibly.

```ts
JSON.stringify(resolveRefPath({ fromPath: "inbox/Job.card", ref: "../../../../etc/passwd", kind: "card" }))
=> null

JSON.stringify(resolveRefPath({ fromPath: "Job.card", ref: "..", kind: "card" }))
=> null
```

A leading slash is box-root-absolute, but `..` still can't climb out of it:

```ts
JSON.stringify(resolveRefPath({ fromPath: "Job.card", ref: "/../etc/passwd", kind: "card" }))
=> null

JSON.stringify(resolveRefPath({ fromPath: "inbox/Job.card", ref: "attach/../../../escape.txt", kind: "card" }))
=> null
```

A `..` that stays inside the box is fine — only leaving is refused:

```ts
resolveRefPath({ fromPath: "inbox/Job.card", ref: "../store/x.card", kind: "card" })
=> store/x.card
```

Refs are filesystem-style paths, never percent-encoded, so `%2e%2e` is a LITERAL directory name — decoding it here would manufacture traversal:

```ts
resolveRefPath({ fromPath: "inbox/Job.card", ref: "%2e%2e/x.card", kind: "card" })
=> inbox/%2e%2e/x.card
```

## Query and fragment are the caller's to split

`resolveRefPath` resolves a *path*; it does not parse `?`/`#`. Run the raw ref through `parseRef` first — this is what stops a `path#fragment` ref (e.g. `feedback.target.ref`) from being checked against the filesystem with its fragment attached:

```ts
const raw = "/store/Plan.doc.card#risks";
resolveRefPath({ fromPath: "inbox/Job.card", ref: parseRef(raw).path, kind: "card" })
=> store/Plan.doc.card
```

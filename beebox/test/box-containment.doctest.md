# Box path containment for card refs

`containWithinBox` and the ref resolvers keep a card ref — a value written by a
human, an agent, or injected content — from resolving to a file outside its
box. A ref that escapes returns `null` and is treated everywhere as a broken
(nonexistent) ref, never followed.

```ts setup
import { symlink } from "node:fs/promises";
import {
  containWithinBox,
  resolveBoxRelativeRef,
  readContainedFile,
  realpathContained,
} from "../src/lib/box-containment.js";
import { resolveContainedRef } from "../src/core/ref-exists.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
```

## `containWithinBox` — the string floor

A path inside the box returns its box-relative form; the box root itself is `""`.

```ts
containWithinBox("/box", "/box/_content/x.card")
=> _content/x.card

containWithinBox("/box", "/box")
=> «blankline»
```

`path.resolve` normalizes `.`, `..`, and trailing separators before the check.

```ts
containWithinBox("/box/", "/box/_content/x/")
=> _content/x

containWithinBox("/box", "/box/_content/./sub/../x.card")
=> _content/x.card
```

Escapes — bare and nested `..`, and any absolute path outside — return `null`.

```ts
JSON.stringify(containWithinBox("/box", "/box/../etc/passwd"))
=> null

JSON.stringify(containWithinBox("/box", "/box/a/../../etc"))
=> null

JSON.stringify(containWithinBox("/box", "/etc/passwd"))
=> null
```

Prefix collision: a sibling directory sharing the root's name prefix is NOT
contained (this is why the check is `=== root || startsWith(root + sep)`, never
a bare `startsWith`).

```ts
JSON.stringify(containWithinBox("/box", "/box-evil/secret"))
=> null

JSON.stringify(containWithinBox("/box", "/boxied"))
=> null
```

## `resolveBoxRelativeRef` — box-root-relative sites

A box-relative ref (or its leading-slash equivalent) resolves against the box
root; `..` that escapes returns `null`.

```ts
resolveBoxRelativeRef("/box", "_content/inbox/x.card")
=> _content/inbox/x.card

resolveBoxRelativeRef("/box", "/_content/inbox/x.card")
=> _content/inbox/x.card

JSON.stringify(resolveBoxRelativeRef("/box", "../etc/passwd"))
=> null

JSON.stringify(resolveBoxRelativeRef("/box", "a/../../etc/passwd"))
=> null
```

## `resolveContainedRef` — the canonical three forms

Box-root-absolute (`/…`), `attach/…`, and document-relative refs all resolve
and contain. A legitimate `..` that stays inside the box is allowed.

```ts
const from = "/box/_content/inbox/Job.email-message.card";

// box-root-absolute
resolveContainedRef({ boxRoot: "/box", ref: "/_content/Foo.card", fromPath: from })
=> _content/Foo.card

// document-relative sibling
resolveContainedRef({ boxRoot: "/box", ref: "reply.card", fromPath: from })
=> _content/inbox/reply.card

// document-relative parent that stays in the box
resolveContainedRef({ boxRoot: "/box", ref: "../x.card", fromPath: from })
=> _content/x.card

// attach/ resolves into the card's own attach scope
resolveContainedRef({ boxRoot: "/box", ref: "attach/photo.jpg", fromPath: "/box/_content/inbox/Foo.image.card" })
=> _content/inbox/Foo.attach/photo.jpg
```

Traversal escapes — including a leading-slash ref that then climbs out —
return `null`.

```ts
JSON.stringify(resolveContainedRef({ boxRoot: "/box", ref: "../../../../etc/passwd", fromPath: "/box/_content/inbox/Job.card" }))
=> null

// bare ".." from a card at the box root escapes to the parent
JSON.stringify(resolveContainedRef({ boxRoot: "/box", ref: "..", fromPath: "/box/Job.card" }))
=> null

// leading-slash ref is box-root-absolute, but `..` still escapes
JSON.stringify(resolveContainedRef({ boxRoot: "/box", ref: "/../etc/passwd", fromPath: "/box/Job.card" }))
=> null
```

A `?query` or `#fragment` addresses a viewer or a location *within* the target,
not a different file, so it is split off before resolution (shared with the
frontend via `src/shared/ref-path.ts`). Handing the fragment to the filesystem
is what used to false-flag `feedback.target.ref`'s documented `path#fragment`
form as a broken ref.

```ts
const fromCard = "/box/_content/inbox/Job.email-message.card";

resolveContainedRef({ boxRoot: "/box", ref: "/_content/Plan.doc.card#risks", fromPath: fromCard })
=> _content/Plan.doc.card

resolveContainedRef({ boxRoot: "/box", ref: "sibling.bill.card?view=ledger", fromPath: fromCard })
=> _content/inbox/sibling.bill.card
```

Refs are filesystem-style, never percent-encoded, so `%2e%2e` is a LITERAL
directory name — decoding here would be a bug that manufactures traversal.

```ts
resolveContainedRef({ boxRoot: "/box", ref: "%2e%2e/x.card", fromPath: "/box/_content/inbox/Job.card" })
=> _content/inbox/%2e%2e/x.card
```

## `readContainedFile` — symlink hardening at the read sink

A legitimate in-box file reads back — even though `makeTmpBox` lives under
macOS's `/var`→`/private/var` symlink, because `realpath` canonicalizes BOTH
the box root and the target.

```ts
const box = await makeTmpBox();
await box.write("_content/note.card", "hello from inside");
const inside = containWithinBox(box.root, box.path("_content/note.card"));
await readContainedFile(box.root, inside)
=> hello from inside
```

An in-box symlink pointing outside passes the string floor (the link sits in
the box) but `realpath` follows it: `realpathContained` returns `null` and the
read throws. A legitimate in-box file, and a not-yet-existing target, both pass
(a missing ref is the caller's to handle, not an escape).

```ts continue
await symlink("/etc/hosts", box.path("_content/escape.card"));
const link = containWithinBox(box.root, box.path("_content/escape.card"));
JSON.stringify(link)
=> "_content/escape.card"

JSON.stringify(await realpathContained(box.root, link))
=> null

const err = await readContainedFile(box.root, link).catch((e) => e);
err.name
=> RefEscapesBoxError

// legit in-box file: returned unchanged
await realpathContained(box.root, inside)
=> _content/note.card

// not-yet-existing in-box target: not an escape, returned unchanged
await realpathContained(box.root, containWithinBox(box.root, box.path("_content/missing.card")))
=> _content/missing.card
```

```ts cleanup
await box.cleanup();
```

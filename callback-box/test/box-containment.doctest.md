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
containWithinBox("/box", "/box/store/x.card")
=> store/x.card

containWithinBox("/box", "/box")
=> «blankline»
```

`path.resolve` normalizes `.`, `..`, and trailing separators before the check.

```ts
containWithinBox("/box/", "/box/store/x/")
=> store/x

containWithinBox("/box", "/box/store/./sub/../x.card")
=> store/x.card
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
resolveBoxRelativeRef("/box", "box/inbox/x.card")
=> box/inbox/x.card

resolveBoxRelativeRef("/box", "/box/inbox/x.card")
=> box/inbox/x.card

JSON.stringify(resolveBoxRelativeRef("/box", "../etc/passwd"))
=> null

JSON.stringify(resolveBoxRelativeRef("/box", "a/../../etc/passwd"))
=> null
```

## `resolveContainedRef` — the canonical three forms

Box-root-absolute (`/…`), `attach/…`, and document-relative refs all resolve
and contain. A legitimate `..` that stays inside the box is allowed.

```ts
const from = "/box/inbox/Job.email-message.card";

// box-root-absolute
resolveContainedRef({ boxRoot: "/box", ref: "/store/Foo.card", fromPath: from })
=> store/Foo.card

// document-relative sibling
resolveContainedRef({ boxRoot: "/box", ref: "reply.card", fromPath: from })
=> inbox/reply.card

// document-relative parent that stays in the box
resolveContainedRef({ boxRoot: "/box", ref: "../store/x.card", fromPath: from })
=> store/x.card

// attach/ resolves into the card's own attach scope
resolveContainedRef({ boxRoot: "/box", ref: "attach/photo.jpg", fromPath: "/box/inbox/Foo.image.card" })
=> inbox/Foo.attach/photo.jpg
```

Traversal escapes — including a leading-slash ref that then climbs out —
return `null`.

```ts
JSON.stringify(resolveContainedRef({ boxRoot: "/box", ref: "../../../../etc/passwd", fromPath: "/box/inbox/Job.card" }))
=> null

// bare ".." from a card at the box root escapes to the parent
JSON.stringify(resolveContainedRef({ boxRoot: "/box", ref: "..", fromPath: "/box/Job.card" }))
=> null

// leading-slash ref is box-root-absolute, but `..` still escapes
JSON.stringify(resolveContainedRef({ boxRoot: "/box", ref: "/../etc/passwd", fromPath: "/box/Job.card" }))
=> null
```

Refs are filesystem-style, never percent-encoded, so `%2e%2e` is a LITERAL
directory name — decoding here would be a bug that manufactures traversal.

```ts
resolveContainedRef({ boxRoot: "/box", ref: "%2e%2e/x.card", fromPath: "/box/inbox/Job.card" })
=> inbox/%2e%2e/x.card
```

## `readContainedFile` — symlink hardening at the read sink

A legitimate in-box file reads back — even though `makeTmpBox` lives under
macOS's `/var`→`/private/var` symlink, because `realpath` canonicalizes BOTH
the box root and the target.

```ts
const box = await makeTmpBox();
await box.write("store/note.card", "hello from inside");
const inside = containWithinBox(box.root, box.path("store/note.card"));
await readContainedFile(box.root, inside)
=> hello from inside
```

An in-box symlink pointing outside passes the string floor (the link sits in
the box) but `realpath` follows it: `realpathContained` returns `null` and the
read throws. A legitimate in-box file, and a not-yet-existing target, both pass
(a missing ref is the caller's to handle, not an escape).

```ts continue
await symlink("/etc/hosts", box.path("store/escape.card"));
const link = containWithinBox(box.root, box.path("store/escape.card"));
JSON.stringify(link)
=> "store/escape.card"

JSON.stringify(await realpathContained(box.root, link))
=> null

const err = await readContainedFile(box.root, link).catch((e) => e);
err.name
=> RefEscapesBoxError

// legit in-box file: returned unchanged
await realpathContained(box.root, inside)
=> store/note.card

// not-yet-existing in-box target: not an escape, returned unchanged
await realpathContained(box.root, containWithinBox(box.root, box.path("store/missing.card")))
=> store/missing.card
```

```ts cleanup
await box.cleanup();
```

# Box Path Normalization

`boxRelativePath` converts the authoring/ref form of a box path (a leading slash
means "box-root-absolute") into the canonical internal box-relative form (no
leading slash) used by `ViewTarget.path`, `file-change` events, and the
`/api/files` + `card.get` + `status.browse` boundaries. Emit boundaries call it
to produce the canonical form; consume boundaries call it to tolerate either
form before comparing or looking up.

```ts setup
import { boxRelativePath } from "../../src/shared/box-path.js";
```

A leading slash (the authoring/ref form) is stripped:

```ts
boxRelativePath("/store/archive/Foo.memo.card")
=> store/archive/Foo.memo.card
```

An already-canonical path is unchanged (idempotent):

```ts
boxRelativePath("store/archive/Foo.memo.card")
=> store/archive/Foo.memo.card
```

Redundant leading slashes collapse, and the empty string (the box root) is left
alone:

```ts
boxRelativePath("///people/Priya.person.card")
=> people/Priya.person.card

JSON.stringify(boxRelativePath(""))
=> ""
```

Only the leading slash is touched — interior and trailing slashes are left as-is
(document-relative resolution is `resolveRelativePath`'s job, not this helper's):

```ts
boxRelativePath("/store//a/b.card")
=> store//a/b.card
```

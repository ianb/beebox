# Nav card resolution

`nav.card` at the box root drives the top navigation (docs/implemented-plans/nav-card.md).
`resolveNav` loads and validates it: `absent` means "show the builtin nav",
`invalid` means "builtin nav + health warning", `ok` carries render-ready
entries plus non-fatal `problems` (dangling refs) for the health check.

```ts setup
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { resolveNav } from "../../src/core/nav.js";
import { parseNavFields } from "../../src/schemas/nav.js";
```

## No nav.card → absent (builtin nav, not a problem)

```ts
const box = await makeTmpBox();
const result = await resolveNav(box.root);
result.status
=> absent
```

## href entries resolve with builtin labels, overridable per entry

```ts
const box = await makeTmpBox();
await box.write("nav.card", `---
entries:
  - { href: / }
  - { href: /chat, label: Recent }
  - { href: /questions }
---
`);
const result = await resolveNav(box.root);
result.status
=> ok

JSON.stringify(result.status === "ok" ? result.entries : null, null, 2)
=>
[
  {
    "kind": "href",
    "target": "/",
    "label": "Dashboard"
  },
  {
    "kind": "href",
    "target": "/chat",
    "label": "Recent"
  },
  {
    "kind": "href",
    "target": "/questions",
    "label": "Questions"
  }
]
```

## ref entries get the target's title, and existence is checked

A ref entry's label falls back to the target card's frontmatter `title`,
then to a filename-derived title. A dangling ref still renders (with
`exists: false`) and is reported in `problems` so the health check can
surface it.

```ts
const box = await makeTmpBox();
await box.write("store/projects/Big_Refactor.memo.card", `---
title: The Big Refactor
contains: project memo
---
Notes.
`);
await box.write("nav.card", `---
entries:
  - { href: /browse }
  - { ref: store/projects/Big_Refactor.memo.card }
  - { ref: store/gone/Missing.memo.card, label: Ghost }
---
`);
const result = await resolveNav(box.root);
JSON.stringify(result.status === "ok" ? result.entries.slice(1) : null, null, 2)
=>
[
  {
    "kind": "ref",
    "target": "store/projects/Big_Refactor.memo.card",
    "label": "The Big Refactor",
    "exists": true
  },
  {
    "kind": "ref",
    "target": "store/gone/Missing.memo.card",
    "label": "Ghost",
    "exists": false
  }
]

JSON.stringify(result.status === "ok" ? result.problems : null)
=> ["ref \"store/gone/Missing.memo.card\" does not point at an existing file"]
```

## A box path (leading `/`) is the canonical ref form

`nav.card` sits at the box root, so the canonical leading-`/` form and the
bare form name the same file. Both resolve; both emit the same normalized
`target` (the shell builds `/<box>/browse/<target>` from it, so the slash
must not survive into the entry).

```ts
const box = await makeTmpBox();
await box.write("store/projects/Big_Refactor.memo.card", `---
title: The Big Refactor
contains: project memo
---
Notes.
`);
await box.write("nav.card", `---
entries:
  - { ref: /store/projects/Big_Refactor.memo.card }
  - { ref: store/projects/Big_Refactor.memo.card, label: Bare }
---
`);
const result = await resolveNav(box.root);
JSON.stringify(result.status === "ok" ? result.entries : null, null, 2)
=>
[
  {
    "kind": "ref",
    "target": "store/projects/Big_Refactor.memo.card",
    "label": "The Big Refactor",
    "exists": true
  },
  {
    "kind": "ref",
    "target": "store/projects/Big_Refactor.memo.card",
    "label": "Bare",
    "exists": true
  }
]

JSON.stringify(result.status === "ok" ? result.problems : null)
=> []
```

A leading-`/` ref at a path that doesn't exist is a dangling ref like any
other — reported in `problems`, still rendered:

```ts continue
await box.write("nav.card", `---
entries:
  - { ref: /store/gone/Missing.memo.card }
---
`);
const missing = await resolveNav(box.root);
JSON.stringify(missing.status === "ok" ? missing.problems : null)
=> ["ref \"/store/gone/Missing.memo.card\" does not point at an existing file"]

JSON.stringify(missing.status === "ok" ? missing.entries[0].target : null)
=> "store/gone/Missing.memo.card"
```

## An unknown href fails validation with the valid set enumerated

```ts
const box = await makeTmpBox();
await box.write("nav.card", `---
entries:
  - { href: /dashboard }
---
`);
const result = await resolveNav(box.root);
result.status
=> invalid

result.status === "invalid" ? result.error.includes("href must be one of: /, /chat, /chats") : null
=> true
```

## Malformed cards are invalid, never a crash

```ts
const box = await makeTmpBox();
await box.write("nav.card", "just some text, no frontmatter\n");
const result = await resolveNav(box.root);
result.status === "invalid" ? result.error : null
=> nav.card has no frontmatter block

await box.write("nav.card", "---\nentries: []\n---\n");
const empty = await resolveNav(box.root);
empty.status
=> invalid
```

## Refs that could escape the box are rejected as problems

A `..` that climbs out of the box is refused — including one hidden behind a
leading `/` — and a ref that reaches outside via an in-box symlink is refused
after the realpath check. Neither entry renders.

```ts
const box = await makeTmpBox();
const { symlink, writeFile } = await import("node:fs/promises");
const outside = `${box.packageRoot}/Secret.memo.card`;
await writeFile(outside, "---\ntitle: Secret\n---\n");
await box.write("store/.keep", "");
await symlink(outside, box.path("store/Leak.memo.card"));

await box.write("nav.card", `---
entries:
  - { href: / }
  - { ref: ../outside/Secret.memo.card }
  - { ref: /../outside/Secret.memo.card }
  - { ref: /store/Leak.memo.card }
---
`);
const result = await resolveNav(box.root);
JSON.stringify(result.status === "ok" ? result.problems : null, null, 2)
=>
[
  "ref \"../outside/Secret.memo.card\" must be box-relative (must not escape the box via ..)",
  "ref \"/../outside/Secret.memo.card\" must be box-relative (must not escape the box via ..)",
  "ref \"/store/Leak.memo.card\" must be box-relative (must not escape the box via a symlink)"
]

result.status === "ok" ? result.entries.length : null
=> 1
```

```ts cleanup
await box.cleanup();
```

## parseNavFields: an entry may be href or ref, not both

```ts
const bad = parseNavFields(`---
entries:
  - { href: /chat, ref: store/x.memo.card }
---
`);
bad.fields === null
=> true
```

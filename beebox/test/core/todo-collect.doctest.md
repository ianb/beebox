# The todo collector (`core/todo/collect.ts`)

Filesystem-tier doctests for `docs/implemented-plans/todo-annotation.md` Track 3:
`collectTodos(boxRoot)` globs every card, parses each body once against the
shared Markdoc vocabulary, and merges both capture forms (`{% todo %}` tags,
frontmatter `todos:` entries) into one deterministically ordered list —
reporting parse/validate/load failures and duplicate `id`s as visible
issues rather than silently dropping a card's todos.

```ts setup
import { collectTodos } from "../../src/core/todo/collect.js";
import { formatTodoLocation } from "../../src/core/todo/collect-types.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const MEMO_FM = "status: new\ncreated: 2026-07-01T10:00:00Z\n";

function memo(frontmatterExtra: string, body: string): string {
  return `---\n${MEMO_FM}${frontmatterExtra}---\n${body}`;
}

process.env.BBX_TIME = "2026-07-28T12:00:00.000Z";

const box = await makeTmpBox();
// America/Chicago is UTC-5 in July (CDT) — the frozen time above is
// 2026-07-28T07:00 local, still July 28th locally, which is what the
// plate-state doctests below assume.
await box.write("_config/box.json", JSON.stringify({ timezone: "America/Chicago" }));
```

## Both capture forms are collected

A body `{% todo %}` tag and a frontmatter `todos:` entry on the same card
both show up, each with its own locator kind.

```ts
await box.write(
  "store/a.memo.card",
  memo(
    'todos:\n  - text: "Renew parking permit"\n    due: "2026-08-15"\n',
    'Body text.\n\n{% todo id="vet-refill" assigned="Dana" %}Call the vet{% /todo %}\n'
  )
);
const result1 = await collectTodos(box.root);
JSON.stringify(result1.todos.map((t) => ({ locator: t.locator, id: t.id, text: t.text })), null, 2)
=>
[
  {
    "locator": {
      "kind": "body",
      "line": 10
    },
    "id": "vet-refill",
    "text": "Call the vet"
  },
  {
    "locator": {
      "kind": "frontmatter",
      "index": 0
    },
    "text": "Renew parking permit"
  }
]
```

`locator.line` is the true FILE line, not the body-relative one: the
frontmatter block's line count (`splitCardContent`'s `lineOffset`) is added
to the tag's body-relative line before reporting it.

```ts continue
result1.issues.length
=> 0
```

## Nested `{% see-also %}` is pulled out, not left in the main text

```ts continue
await box.write(
  "store/b.memo.card",
  memo(
    "",
    '{% todo id="with-see-also" %}Ping Marcus {% see-also ref="store/a.memo.card" %}he offered to help{% /see-also %} about the quote.{% /todo %}\n'
  )
);
const result2 = await collectTodos(box.root, { glob: "store/b.memo.card" });
JSON.stringify(result2.todos[0].seeAlso)
=> [{"ref":"store/a.memo.card","note":"he offered to help"}]

result2.todos[0].text
=> Ping Marcus about the quote.
```

## Plate-state derivation around the frozen time (2026-07-28, box-local)

`escalated` (past `due`), `on-plate` (undated, or `start` already reached),
`quiet` (before `start`), and `parked` are each derived from the shared
`todo-model.ts` truth table using the box's configured timezone.

```ts continue
await box.write(
  "store/plate.memo.card",
  memo(
    "",
    [
      '{% todo id="p-escalated" due="2026-07-27" %}Overdue{% /todo %}',
      "",
      '{% todo id="p-on-plate" %}Undated, on the plate now{% /todo %}',
      "",
      '{% todo id="p-quiet" due="2026-08-01" start="2026-07-30" %}Not yet{% /todo %}',
      "",
      '{% todo id="p-parked" status="parked" %}Parked{% /todo %}',
      "",
    ].join("\n")
  )
);
const plateResult = await collectTodos(box.root, { glob: "store/plate.memo.card" });
JSON.stringify(
  Object.fromEntries(plateResult.todos.map((t) => [t.id, t.plateState])),
  null,
  2
)
=>
{
  "p-escalated": "escalated",
  "p-on-plate": "on-plate",
  "p-quiet": "quiet",
  "p-parked": "parked"
}
```

## A `{% todo %}` with an invalid `status` is a visible-invalid result, not a silent drop

```ts continue
await box.write(
  "store/bad-status.memo.card",
  memo("", '{% todo status="Done" %}Bad status{% /todo %}\n')
);
const badStatusResult = await collectTodos(box.root, { glob: "store/bad-status.memo.card" });
badStatusResult.todos.length
=> 0

JSON.stringify(badStatusResult.issues.map((i) => i.kind))
=> ["validate"]

badStatusResult.issues[0].message
=> line 1: Attribute 'status' must match one of ["open","done","dropped","parked"]. Got 'Done' instead.
```

## A multi-line `{% todo %}` block with an invalid `status` is also visible-invalid, not silently coerced to `open`

Regression coverage for the `collectTagSpans`/`tagNameFor` line-attribution
bug: a **multi-line block** `{% todo %}` (opening tag, body, closing tag on
separate lines) used to fall through the "which tag does this validate error
belong to" match (it compared against `lines[1]`, correct only for a one-line
span) and get attributed to `(body)` instead of `todo` — so
`collect-body.ts`'s `todoErrors` filter never caught it, and the invalid
`status` was silently coerced to `"open"` instead of becoming a visible-invalid
result.

```ts continue
await box.write(
  "store/bad-status-multiline.memo.card",
  memo("", '{% todo status="Done" %}\nBad status, multi-line\n{% /todo %}\n')
);
const badStatusMultiline = await collectTodos(box.root, { glob: "store/bad-status-multiline.memo.card" });
badStatusMultiline.todos.length
=> 0

JSON.stringify(badStatusMultiline.issues.map((i) => i.kind))
=> ["validate"]
```

## A card whose type has no registered schema is a visible `unknown-type` issue, not a silent skip

```ts continue
await box.write(
  "store/unknown-type.memmo.card",
  memo("", '{% todo %}Never collected — unregistered type{% /todo %}\n')
);
const unknownTypeResult = await collectTodos(box.root, { glob: "store/unknown-type.memmo.card" });
unknownTypeResult.todos.length
=> 0

unknownTypeResult.issues[0].kind
=> unknown-type

unknownTypeResult.issues[0].message
=> no registered schema for card type "memmo"
```

## Unparseable frontmatter is a visible `load` issue

```ts continue
await box.write(
  "store/bad-frontmatter.memo.card",
  "---\nstatus: new\ncreated: not-a-date\n---\n{% todo %}Never collected{% /todo %}\n"
);
const badLoadResult = await collectTodos(box.root, { glob: "store/bad-frontmatter.memo.card" });
badLoadResult.todos.length
=> 0

badLoadResult.issues[0].kind
=> load
```

## Duplicate `id` across cards is reported, but both todos still come back

```ts continue
await box.write("store/dup1.memo.card", memo("", '{% todo id="shared" %}First{% /todo %}\n'));
await box.write("store/dup2.memo.card", memo("", '{% todo id="shared" %}Second{% /todo %}\n'));
const dupResult = await collectTodos(box.root, { glob: "store/dup{1,2}.memo.card" });
dupResult.todos.map((t) => t.text).join(", ")
=> First, Second

dupResult.issues.length
=> 1

dupResult.issues[0].kind
=> duplicate-id

dupResult.issues[0].message
=> duplicate todo id "shared" used at: store/dup1.memo.card:5, store/dup2.memo.card:5
```

## `--glob` scopes which cards are scanned

```ts continue
await box.write("other/c.memo.card", memo("", '{% todo id="outside-scope" %}Not scoped in{% /todo %}\n'));
const scoped = await collectTodos(box.root, { glob: "store/dup1.memo.card" });
scoped.todos.map((t) => t.id).join(", ")
=> shared
```

## A directory-shaped glob scopes to cards; non-card files are not "unreadable cards"

The box-wide plate ships `glob: "**"` and project plates use bare directory
globs (`store/projects/foo/**`) — patterns that match every file under their
scope, not just cards. Non-card files (`_config/box.json`, a stray `.md`) are
not todo candidates and must not surface as read failures: before
`listTodoCardPaths` scoped every pattern to `.card` files centrally, a
box-wide plate rendered every non-card file in the box as a
"card couldn't be read" error.

```ts continue
await box.write("store/notes.md", "Not a card at all.\n");
const wideOpen = await collectTodos(box.root, { glob: "**" });
wideOpen.issues.filter((i) => i.path === "store/notes.md" || i.path === "_config/box.json")
=> []

wideOpen.todos.length > 0
=> true
```

## A malformed box timezone degrades instead of crashing the whole collector

`_config/box.json`'s `timezone` is hand-editable; a typo'd IANA zone (e.g.
`"America/Chciago"`) used to make `Intl.DateTimeFormat` throw a bare
`RangeError` the moment plate-state derivation ran for ANY todo — taking
down `collectTodos` (and everything built on it: `bbx todos`, `todos.list`,
the badge, the review sweep) rather than just that one box's timezone
display. `loadBoxTimezone` now validates and falls back to the host
timezone with a warning instead of throwing.

```ts continue
const badTzBox = await makeTmpBox();
await badTzBox.write("_config/box.json", JSON.stringify({ timezone: "America/Chciago" }));
await badTzBox.write(
  "store/x.memo.card",
  memo("", '{% todo id="survives" %}Should still collect{% /todo %}\n')
);
const badTzResult = await collectTodos(badTzBox.root);
badTzResult.todos.map((t) => t.id).join(", ")
=> survives

await badTzBox.cleanup();
```

## Deterministic ordering: path, then locator

Re-running the full-box collection returns todos in the same path-then-
locator order every time (body locators sort before frontmatter locators on
the same card).

```ts continue
const full = await collectTodos(box.root);
full.todos.map((t) => `${t.path}#${formatTodoLocation(t)}`).join("\n")
=>
other/c.memo.card#other/c.memo.card:5
store/a.memo.card#store/a.memo.card:10
store/a.memo.card#store/a.memo.card#todos[0]
store/b.memo.card#store/b.memo.card:5
store/dup1.memo.card#store/dup1.memo.card:5
store/dup2.memo.card#store/dup2.memo.card:5
store/plate.memo.card#store/plate.memo.card:5
store/plate.memo.card#store/plate.memo.card:7
store/plate.memo.card#store/plate.memo.card:9
store/plate.memo.card#store/plate.memo.card:11
```

```ts cleanup
await box.cleanup();
```

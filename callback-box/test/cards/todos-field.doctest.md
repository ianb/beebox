# Frontmatter `todos:` — the universal field

Load-path doctests for `docs/implemented-plans/todo-annotation.md` Track 2: the optional
`todos:` frontmatter field joins `title`/`contains` in `GLOBAL_CARD_FIELDS`
(`src/cards/schema.ts`). One entry shape (`text` required, the rest mirroring
the `{% todo %}` tag's attributes and `TODO_STATUSES` enum), validated by the
same `validateTodoAttributes` the tag uses (`src/shared/todo-model.ts`) — one
source of truth, not two.

```ts setup
import { z } from "zod";
import { cardSchema, body, type CardSchema } from "../../src/cards/index.js";
import { parseCardText, CardIOError } from "../../src/core/card-io.js";

const memoSchema: CardSchema = cardSchema("memo-fixture", {
  fields: {
    status: z.string().optional(),
    body: body(z.string()),
  },
});

const schemas = new Map<string, CardSchema>([["memo-fixture", memoSchema]]);

function load(frontmatter: string): unknown {
  const text = `---\n${frontmatter}\n---\nBody.\n`;
  return parseCardText(text, { source: "x.memo-fixture.card", schemas }).fields;
}

function loadErr(frontmatter: string): string {
  try {
    load(frontmatter);
    return "no error";
  } catch (e) {
    if (e instanceof CardIOError) return e.message;
    throw e;
  }
}
```

## A valid `todos:` list loads

```ts
const fields = load(
  "todos:\n  - text: Renew the parking permit\n    due: 2026-08-15\n  - text: Ask Marcus about the quote\n    assigned: agent\n    status: parked\n"
);
JSON.stringify(fields["todos"])
=> [{"text":"Renew the parking permit","due":"2026-08-15"},{"text":"Ask Marcus about the quote","assigned":"agent","status":"parked"}]
```

## A card with no `todos:` key loads fine (it's optional)

```ts
const fields = load("status: new");
fields["todos"]
=> undefined
```

## Bad `status` value is rejected

```ts
loadErr("todos:\n  - text: Bogus\n    status: wontfix\n")
=>
x.memo-fixture.card: invalid memo-fixture frontmatter:
  - todos[0].status: Invalid option: expected one of "open"|"done"|"dropped"|"parked"
```

## Relative `start` without `due` is rejected

```ts
loadErr("todos:\n  - text: Bogus\n    start: -3d\n")
=>
x.memo-fixture.card: invalid memo-fixture frontmatter:
  - todos[0]: {% todo %} a relative `start` ("-3d") requires `due` to be set
```

## `start` after `due` is rejected

```ts
loadErr("todos:\n  - text: Bogus\n    start: 2026-08-05\n    due: 2026-08-01\n")
=>
x.memo-fixture.card: invalid memo-fixture frontmatter:
  - todos[0]: {% todo %} `start` ("2026-08-05") is after `due` ("2026-08-01")
```

## `by: agent` without `created` is rejected

The validation message names the tag (`{% todo %}`) because it's the same
`validateTodoAttributes` call the Markdoc tag uses (one source of truth, not
restated) — a minor wording mismatch for a frontmatter-authored entry, noted
as a spec friction rather than fixed unilaterally.

```ts
loadErr("todos:\n  - text: Bogus\n    assigned: agent\n    by: agent\n")
=>
x.memo-fixture.card: invalid memo-fixture frontmatter:
  - todos[0]: {% todo %} `created` is required when `by="agent"`
```

## `by: agent` with `created` is valid

```ts
const fields = load(
  "todos:\n  - text: Bogus\n    by: agent\n    created: 2026-07-28\n"
);
JSON.stringify(fields["todos"])
=> [{"text":"Bogus","by":"agent","created":"2026-07-28"}]
```

## `see-also` with neither `ref` nor `href` is rejected

```ts
loadErr("todos:\n  - text: Bogus\n    see-also:\n      - note: missing a target\n")
=>
x.memo-fixture.card: invalid memo-fixture frontmatter:
  - todos[0].see-also[0]: todos `see-also` entry requires exactly one of `ref` or `href`
```

## `see-also` with both `ref` and `href` is rejected

```ts
loadErr(
  "todos:\n  - text: Bogus\n    see-also:\n      - ref: store/people/dana.person.card\n        href: https://example.com\n        note: too many\n"
)
=>
x.memo-fixture.card: invalid memo-fixture frontmatter:
  - todos[0].see-also[0]: todos `see-also` entry takes exactly one of `ref` or `href`, not both
```

## A valid `see-also` entry round-trips

```ts
const fields = load(
  "todos:\n  - text: Call the vet\n    see-also:\n      - ref: people/Dana_Whitfield.person.card\n        note: Dana offered to pick it up\n"
);
JSON.stringify(fields["todos"])
=> [{"text":"Call the vet","see-also":[{"ref":"people/Dana_Whitfield.person.card","note":"Dana offered to pick it up"}]}]
```

## A schema declaring its own `todos` field wins

Same precedence rule as `title`/`contains` (`GLOBAL_CARD_FIELDS` doc comment,
`src/cards/schema.ts`): a schema's own declaration is used instead of the
injected global one — here, a schema that requires `todos` to be a plain
string rather than the universal list shape.

```ts
const ownTodosSchema: CardSchema = cardSchema("own-todos-fixture", {
  fields: {
    todos: z.string(),
    body: body(z.string()),
  },
});
const ownSchemas = new Map<string, CardSchema>([["own-todos-fixture", ownTodosSchema]]);

const text = "---\ntodos: just one plain string\n---\nBody.\n";
const card = parseCardText(text, { source: "y.own-todos-fixture.card", schemas: ownSchemas });
card.fields["todos"]
=> just one plain string
```

The universal list shape is rejected by this schema's override (it wants a
string, not an array):

```ts continue
function classifyError(fn: () => unknown): string {
  try {
    fn();
    return "no error";
  } catch (e) {
    return e instanceof CardIOError ? "CardIOError" : "other";
  }
}

classifyError(() =>
  parseCardText("---\ntodos:\n  - text: Should not validate here\n---\nBody.\n", {
    source: "z.own-todos-fixture.card",
    schemas: ownSchemas,
  })
)
=> CardIOError
```

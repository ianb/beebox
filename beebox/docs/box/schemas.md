---
read-when: Adding or changing a box-local card schema under `src/schemas/`, its validate/summarize hooks, or its templates, or checking what schema and view code may import.
---

# Writing Box-Local Schemas

Box-local schemas let you define new card types inside your box. Each schema is a `.ts` file
in `src/schemas/` that uses the same tools as built-in schemas.

**Default to the frontmatter form** (`cardSchema`): it produces standard cards, YAML
frontmatter plus a markdown body, which every tool in the box understands.

## Creating a Schema

Create a `.ts` file in `src/schemas/` that default-exports a `cardSchema()`:

```typescript
import { body, cardSchema } from "beebox/cards";
import { z } from "beebox/schema";

export default cardSchema("my-type", {
  fields: {
    priority: z.enum(["low", "medium", "high"]).optional(),
    archived: z.boolean().optional(),
    body: body(z.string()),  // omit this line if the card has no prose body
  },
  instructions: \`# My Type Cards

Instructions for the agent on how to handle this card type.
These appear in .claude/rules/ and _content/docs/generated/, and are loaded
when the agent reads or edits a matching card file.\`,
});
```

The filename becomes the card type: `src/schemas/task.ts` → `*.task.card` files.

On disk, a card of this type is YAML frontmatter + markdown body:

```
---
title: Replace the gutter
priority: high
---
The markdown body (present only when the schema declares a `body` field).
```

Key patterns:
- `cardSchema(type, { fields, instructions? })` is the entry point. `fields` is a flat object
  of Zod validators; nest with `z.object` / `z.array` as needed.
- `body(z.string())` declares the markdown body field — it must be named `body`. Omit it for a
  body-less card (then any non-empty body errors on load).
- `type` is the discriminator; don't list it under `fields`, and the on-disk YAML needn't carry
  it — the filename `Foo.<type>.card` supplies it.
- The global fields are available on every card type automatically: `title`,
  `contains`, `contains-evidence`, `todos`, `symbol`, `prominence`, and `theme`.
  Don't redeclare them, except `title: z.string()` to require a title.
- Give every field a reader (a view, a query, or instructions that act on it).
  Some names are reserved: `status`, `created`, `summary`, `date`, `modified`,
  `source`, and the global fields above. The box health check flags a schema that
  declares one. Record the specific fact instead: a named boolean
  (`archived: true`), a date named for what it is (`due`, see
  [Dates](#dates)), or `sources: [{ ref }]` for what the card was derived from.
- `brief` (five words or fewer) is the type's entry in the agent guide's card-type list, read on
  every turn; `description` (one line) is its row in the docs index. Without a `brief` the guide
  lists the `description`.

## Dates

A date that belongs to the card's subject (when a bill is due, when a letter
was written) is a **date entry**: `DateEntrySchema` from `beebox/cards`,
`{ value, kind?, end?, note? }`. `value` is ISO 8601 at the precision known:
`"1974"`, `1974-06`, `1974-06-02`, or a date and time with an offset
(`2026-09-28T09:30:00-05:00`). Quote a bare year: unquoted, YAML reads it as a
number. `end`, in the same format, makes the entry a range. `kind` says which
date it is when a card has several; `note` is prose. When the card was written
is not a date entry: git records that.

One such date is a field named for it; several are a `dates` list with a
`kind` each:

```typescript
import { cardSchema, DateEntrySchema } from "beebox/cards";
import { z } from "beebox/schema";

export default cardSchema("bill", {
  fields: {
    payee: z.string(),
    due: DateEntrySchema,
    dates: z.array(DateEntrySchema).optional(),
  },
});
```

```
---
payee: Water utility
due:
  value: 2026-10-15
dates:
  - value: 2026-09-20
    kind: issued
  - value: 2026-08-01
    end: 2026-08-31
    kind: billing-period
---
```

## Renaming a field

`bbx validate` lists box-local schemas that declare a reserved field name
(`status`, `date`, `source`, …) under "Box-local schemas declare reserved
field names". To move the cards off such a field, write a field map and apply
it with `bbx migrate-fields`:

```yaml
# _config/migration-runs/fields.map.yaml
types:
  book:
    status: { rename: ownership }        # keep the value under a new name
  bill:
    status:
      values:                             # each old value becomes these fields
        paid: { paid: true }
        auto-pay: { auto-pay: true }
        unpaid: {}                        # nothing: absence means unpaid
      unlisted: refuse                    # refuse (default) | drop
    date: { rename: due }
  lesson:
    "segments[].status": { rename: stage } # each entry of a list
  progress:
    "units{}.status": { rename: stage }    # each value of a map
  docket-entry:
    date: { wrap: { field: filed, key: value } }        # filed: { value: <old date> }
  snapshot:
    source: { wrap: { field: sources, key: href, list: true } }  # sources: [{ href: <old> }]
```

```bash
bbx migrate-fields _config/migration-runs/fields.map.yaml          # dry run: what would change
bbx migrate-fields _config/migration-runs/fields.map.yaml --apply
```

Only the named keys change; every other line of a card stays as it was. A
card with a value the map does not list, or that already has the new key, is
refused and reported, so a person can decide. Change the schema and any view
that reads the old field in the same commit, then run `bbx validate` and
`bbx view typecheck`.

## Validation beyond Zod — the `validate` hook

When a card type needs a rule Zod field types can't express — a cross-field
constraint, a format refinement, or checking the body's parsed structure — add a
`validate` hook to the schema. The rule lives **on the schema**, co-located with
the type it governs; `bbx validate` invokes it automatically.

```typescript
import { cardSchema, type LintIssue } from "beebox/cards";
import { z } from "beebox/schema";

export default cardSchema("link", {
  validate: ({ fields }) => {
    const errors: LintIssue[] = [];
    const url = fields["url"];
    if (typeof url === "string" && !url.startsWith("https://")) {
      errors.push({ type: "validation", severity: "error", message: `url must be https (got "${url}")` });
    }
    return errors;
  },
  fields: { url: z.string() },
});
```

- The hook receives `{ fields }` — the parsed frontmatter, with the body at
  `fields["body"]` when the schema has one. Narrow values yourself (`typeof`).
- It is **self-contained**: it sees only this card's own data, never other cards
  or the box. Broken-ref checking is handled for you and is not its job.
- Return `LintIssue[]` (`severity: "error"` blocks; `[]` means clean).

## How the card appears in a list — the `summarize` hook

Every list in the box — search results, a directory listing, a todo list's
card headers — shows a card through its summary. By default that is the
card's `title` (or its filename), its `contains` sentence, and its mark.
Add `summarize` when the type can say something better about itself:

```typescript
export default cardSchema("plant", {
  fields: { species: z.string(), lastWatered: z.string().optional() },
  summarize: (card, base) => ({
    ...base,
    detail: card.lastWatered === undefined ? "never watered" : `watered ${card.lastWatered}`,
  }),
});
```

- `card` is this card's parsed fields, typed from your own `fields`.
- `base` is the standard summary (`title`, `contains`, `symbol`). Spread it
  and add `detail` — a short second line — or replace `title` outright.
- It runs only on a card that passed validation; one that failed keeps the
  filename summary.

## Available Imports

**Imports.** Schema and view code (a trick keeps its own packages; see `tricks.md`) may only import from the beebox library surface: `beebox/cards` (card/schema primitives), `beebox/schema` (Zod and YAML, version-pinned to the engine), and `beebox/view-widgets` (view components). Don't add other dependencies to `package.json` — that file isn't yours to edit.

From `beebox/cards` (`validate` and `summarize` are config hooks on `cardSchema`, not imports):
- `cardSchema(type, config)` — define a frontmatter card schema
- `body(zodSchema)` — declare the single markdown body field
- `type LintIssue` — the issue type a `validate` hook returns (see above)
- `DateEntrySchema` — a date that belongs to the card's subject (see [Dates](#dates))

From `beebox/schema`:
- `z` — Zod schema builder (z.string(), z.enum(), z.array(), etc.)
- `parseYaml`/`stringifyYaml` — YAML (de)serialization, e.g. for a `template.generate`

## Optional: Templates

Export a `template` to enable `bbx create` for your card type. For frontmatter schemas,
`generate` returns the card text — a YAML frontmatter block built with `stringifyYaml` from `beebox/schema`:

```typescript
import { cardSchema } from "beebox/cards";
import { stringifyYaml, z } from "beebox/schema";

export const template = {
  name: "task",
  description: "A task card",
  argsSchema: z.object({
    title: z.string().describe("Task title"),
    priority: z.enum(["low", "medium", "high"]).optional().describe("Priority level"),
  }),
  generate: (args: { title: string; priority?: string }) => {
    const fields: Record<string, unknown> = { title: args.title };
    if (args.priority !== undefined) fields.priority = args.priority;
    return "---\n" + stringifyYaml(fields) + "---\n";
  },
  cardTypes: ["task"],
  defaultForTypes: ["task"],
};

export default cardSchema("task", {
  // ... schema definition
});
```

## After Adding or Modifying Schemas

Two independent things happen — don't conflate them:

**1. The card type works immediately.** Loading, validation, and rendering pick
up a new or edited schema on the next `bbx` command automatically, and the running
web server hot-reloads schema files on save too. You do **not** need to run
anything to "register" a schema — that was never what `bbx engine init` did.

**2. Regenerate the agent-facing docs from `instructions`** — this is what
`bbx engine init` is for:

```bash
bbx engine init .
```

This regenerates, from each schema's `instructions`:
- `.claude/rules/card-<type>.md` (auto-loaded when you edit a matching card)
- `_content/docs/generated/card-<type>.md`
and registers any `template` exports for `bbx create`. Run it after you add or
change a schema's `instructions` so the guidance an agent reads stays current. It
does not touch the running server's schema registration (a fresh `bbx` process
can't — and doesn't need to).

## Tips

- Keep schema files focused — one card type per file
- Always include `instructions` so the agent knows how to handle the card type
- Test with `bbx validate` after creating cards of the new type

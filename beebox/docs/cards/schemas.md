# Card schemas

Adding a card type: the schema file and its hooks, registration, the
template, and the generated instructions doc.

## What it is

How to add a new card type to beebox. Reference: `src/schemas/briefing.tsx` (frontmatter with body) or `src/schemas/intake-job.tsx` (frontmatter, no body).

## When to Create a New Card Type

Create a new schema when:
- The data has a distinct structure that doesn't fit `record` or `memo`
- You need specific validation (typed fields, required values)
- The agent needs domain-specific instructions for handling the data

If it's just a generic captured thing, use `record` instead.

## Files to Touch

Adding a frontmatter schema touches 4 files, plus creates 1 new one.

### 1. Create the Schema File

`src/schemas/<name>.ts` (use `.tsx` only if you need JSX somewhere; templates emit YAML strings now, not JSX).

```ts
import { body, cardSchema, type CardSchema } from "../exports/cards.js";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

export const MyThingPriority = z.enum(["low", "medium", "high"]);
export type MyThingPriorityType = z.infer<typeof MyThingPriority>;

const NoteEntry = z.object({
  text: z.string(),
  ref: z.string().optional(),
});

export const MyThingSchema: CardSchema = cardSchema("my-thing", {
  brief: "A my-thing card",  // five words or fewer: the agent guide's card-type list
  description: "One line on what a my-thing card holds and is for",  // the docs index row
  fields: {
    priority: MyThingPriority.optional(),
    archived: z.boolean().optional(),
    notes: z.array(NoteEntry).optional(),
    body: body(z.string()),  // omit this line if the card has no prose body
  },
  instructions: `# My Thing Cards

Instructions for agents on how to handle this card type.
This becomes card-my-thing.md in the package docs (`node_modules/beebox/box-docs/` from a box; `beebox/box-docs/` in this checkout).

Include:
- What each frontmatter field means
- Whether the body is required and what goes there
- Where cards should be stored
- Any special conventions`,
});

export interface MyThingFields {
  type: "my-thing";
  priority?: MyThingPriorityType;
  archived?: boolean;
  notes?: Array<{ text: string; ref?: string }>;
  body: string;  // omit if no body
}

export function createMyThingTemplate(options: { title: string }): string {
  const fields: Record<string, unknown> = {
    title: options.title,
  };
  return `---\n${stringifyYaml(fields)}---\n`;
}
```

Key patterns:
- `cardSchema(type, { fields, instructions? })` is the entry point. `fields` is a flat object of Zod validators; nest with `z.object` / `z.array` as needed.
- Every schema automatically gets seven optional frontmatter fields — `title`, `contains`, `contains-evidence`, `todos`, `symbol`, `prominence`, and `theme` (`GLOBAL_CARD_FIELDS` in `src/cards/schema.ts`; the docblock there describes each) — don't redeclare them in `fields` or in your `*Fields` interface (see [Adding a field](#adding-a-field); the one exception is `title: z.string()` to make `title` required, and `title` always leads the frontmatter). `contains` is the field agents should populate: a one-sentence summary that's the prime retrieval field for search and listings (it's boosted in ranking — see `src/core/search/query/core.ts`). `prominence` (`entry-point` | `primary` | `background`) is who a card is for — absent means the type's default level, which you can set with `cardSchema`'s own `prominence` option (`src/shared/prominence.ts`; `category: "system"` implies `background` unless you say otherwise). `theme: { name, stock? }` selects presentation independently of the card's view; a type can prefer one with `cardSchema`'s `theme` option. In the web UI, `title` shows in the card header, `todos` on the front, `contains`, `contains-evidence`, `prominence`, and `symbol` under Properties "Found by", and `theme` as the Properties "Appearance" row; a type's own fields show under Properties "Fields" when the type declares a body field, and on the front when it does not. The worked example above still sets `title` in `createMyThingTemplate()`, which is fine — templates can populate a global field without the schema redeclaring it.
- Cards also accept the optional `theme: {name, stock?}` presentation choice. It is catalog-validated against the built-in theme IDs and stocks; see [`docs/box/card-themes.md`](../box/card-themes.md) before adding a type preference with `cardSchema`'s `theme` option. Theme is a presentation override, not a new view or a replacement for the card's type fields.
- `body(z.string())` declares a markdown body field — it must be named `body` (enforced; one vocabulary across all card types). Omit to declare a body-less card (then any non-empty body errors on load).
- The filename's `.<type>.card` segment is the discriminator ([format](format.md#format)). A `type:` frontmatter key is tolerated on read and must match the filename; templates may still emit it, and the serializer never writes it back.
- Refs live in the YAML as either `{ref: "..."}` objects or strings in obvious places (e.g. `participants: [{ref: "people/..."}]`). The validator's ref-walker finds them by walking for `ref:` keys.
- Avoid `?: T | undefined` in `*Fields` interfaces — use `?: T` and spread conditionally at call sites. Zod recursive types are the exception (they need the explicit `| undefined`).
- The `instructions` string is what agents see — make it thorough.

#### Validation beyond Zod — the `validate` hook

When a card type needs a rule Zod field types can't express — a cross-field
constraint, a format refinement on a string, or validation of the body's parsed
structure — put it in a **`validate` hook on the schema**, *not* in a branch of
`src/core/card-lint/core/lint-cards.ts`. The hook co-locates the rule with the schema that
defines the type, and card-lint dispatches it generically.

```ts
import { cardSchema, type CardSchema, type LintIssue } from "../exports/cards.js";

function myThingErrors(fields: Record<string, unknown>): LintIssue[] {
  const errors: LintIssue[] = [];
  const href = fields["href"];
  if (typeof href === "string" && !href.startsWith("file:")) {
    errors.push({ type: "validation", severity: "error", message: `href must be a file: URL (got "${href}")` });
  }
  return errors;
}

export const MyThingSchema: CardSchema = cardSchema("my-thing", {
  validate: ({ fields }) => myThingErrors(fields),
  fields: { /* ... */ },
});
```

- The hook receives `{ fields }` — the parsed, Zod-validated frontmatter, with
  the body value at `fields["body"]` when the schema declares a body. Narrow
  `fields[...]` yourself (`typeof x === "string"`) before using it.
- It is **self-contained**: it sees only this card's own data — no loader, no
  box, no access to other cards. Generic ref-existence checking (does the card
  a `ref:` points at exist?) is box-aware and stays centralized in `card-lint.ts`;
  don't reimplement it per schema.
- It returns `LintIssue[]` (`type: "validation"`, `severity: "error"`
  for blocking rules). Return `[]` when the card is fine.
- Keep the error/helper functions **module-private** (don't export them — knip
  flags unused exports); only the `validate` reference uses them. `extfile.tsx`
  and `commentary.tsx` are worked examples (a `file:`-URL refinement and a
  Markdoc body check, respectively).

There is intentionally **no box-aware validate variant** today — if you find
yourself wanting one (resolve a ref, inspect another card), raise it rather than
smuggling box access in; the self-contained shape is the deliberate contract.

#### How the card appears in a list — the `summarize` hook

A card's list row — a header in a todo list, a line in the recent-files
dropdown, a tool-use expansion — is a `FileSummary`. Every card gets a base
one for free: its `title:` field or its filename, plus `contains:` and
`symbol:`. Add `summarize` when the type can say something better.

```ts
export const ExpenseSchema = cardSchema("expense", {
  fields: { amount: z.number(), vendor: z.string(), paid: z.boolean() },
  summarize: (card, base) => ({
    ...base,
    title: card.vendor,
    detail: `${String(card.amount)} · ${card.paid ? "paid" : "due"}`,
    attrs: { paid: card.paid },
  }),
});
```

- `card` is this schema's own validated fields, typed from the `fields`
  declaration. No hand-parsing, no `fields["amount"]`.
- `base` is the standard summary. Spread it to extend (`{ ...base, detail }`)
  or override the parts you want to replace.
- `detail` is a second line shown under the title. `summaryText(summary)`
  (`src/core/file-summary.ts`) is its text form: `title — detail`.
- `attrs` is a typed payload for the type's list component. Read it back with
  `SummaryAttrs<typeof ExpenseSchema>`.
- It runs only on a card that validated. One that didn't keeps the base
  summary from its filename.
- Keep it pure — no box access, no clock, no I/O. It runs once per row. A hook
  that throws is logged and the row falls back to the base summary.

`summarize` is part of the public `beebox/cards` API, so a box-local schema
can define one.

#### Box-owned state on *template* cards — the `templateMerge` policy

Only relevant if your card type is one beebox **ships and updates as a
template** (procedures, guides, schedules — the things `bbx init` installs and
later re-syncs). Box-local schemas and ordinary authored cards never install as
templates, so they don't need this.

The default sync rule is strict: when an upstream template changes, a box gets
the new version only if its copy is unmodified stock; if the box edited the
card **at all**, the update is parked in `_config/_template-updates/` for review
rather than clobbering the edit. That's usually right — but some fields are
per-box **state**, not part of the definition, and a change to one shouldn't
freeze the box on old content. The canonical case is a schedule's `enabled`: a
box turning a schedule off for itself should still receive later definition
updates (new cron, runs, description), not have the whole card park forever.

Declare those keys as box-owned with `templateMerge`:

```ts
export const ScheduledScriptSchema: CardSchema = cardSchema("scheduled-script", {
  fields: { /* ... enabled: z.boolean().optional(), ... */ },
  templateMerge: { boxOwnedFields: ["enabled"] },
});
```

Effect on the sync:

- The owned keys are **stripped before** the customised-or-not comparison, so a
  box differing from stock *only* in them still reads as unmodified and takes
  the update.
- The box's own values for those keys are **carried onto** the new version when
  it's written (the schedule stays disabled).
- Divergence in **any other key or the body** still parks — a retimed `cron` or
  edited `runs` is a real customization and is never overwritten.

A parked update is **reported, not silent**: `bbx status` lists the parked paths,
and `bbx health`'s `template-updates` box check reports them too — escalating from
`warning` to `error` when a parked path is the procedure or task card behind a
scheduled task that is currently failing or inconclusive, since that task's fix
is then already sitting on disk unread. See
[`health-checks.md`](../server/health-checks.md#template-updates-a-fix-that-never-reached-the-box).

It is deliberately a **field list, not a `merge(box, upstream)` callback**. The
judgement that matters — "is this box on unmodified old stock, or did the
boxholder edit the definition?" — needs the last-shipped hash, which lives in
the version tracker (`_config/template-versions.json`), not in the two card
texts. A free callback couldn't see that and would have to either clobber real
edits or freeze old stock. Naming which keys are *state* lets the tracker keep
making that call correctly. (Implementation: `boxOwnedFields` on
`installTemplateFile`, `src/core/install-template-file.ts`.)

### 2. Register in `src/schemas.ts`

```ts
import { MyThingSchema } from "./my-thing.js";

// Add to cardSchemas[] (frontmatter cards):
export const cardSchemas: CardSchema[] = [
  // ...existing schemas...
  MyThingSchema,
];

// Add re-export at bottom:
export { MyThingSchema } from "./my-thing.js";
```

### 3. Register in `src/schemas/index.ts`

```ts
// Type
export type { MyThingFields, MyThingPriorityType } from "./my-thing.js";

// Template
export { createMyThingTemplate } from "./my-thing.js";
```

### 4. Register Template in `src/schemas/templates.ts`

```ts
import { createMyThingTemplate } from "./my-thing.js";

registerTemplate({
  name: "my-thing",
  description: "A my-thing card — short description for `bbx create -t`",
  cardTypes: ["my-thing"],
  defaultForTypes: ["my-thing"],
  argsSchema: z.object({
    title: z.string().describe("Display title"),
  }),
  generate: (args) => createMyThingTemplate({ title: args.title }),
});
```

The project uses `exactOptionalPropertyTypes: true`. When forwarding optional args, build the options object incrementally:

```ts
generate: (args) => {
  const opts: Parameters<typeof createMyThingTemplate>[0] = { title: args.title };
  if (args.description !== undefined) opts.description = args.description;
  return createMyThingTemplate(opts);
},
```

### 5. (Optional) Add a Storage Directory

If the card type has its own storage location, add it to `BOX_DIRS` in `src/lib/paths/core.ts`:

```ts
export const BOX_DIRS = {
  // ...
  mythings: "_content/mythings",
};
```

`bbx init` iterates `Object.values(BOX_DIRS)` and creates each directory automatically.

### 6. (Optional) Frontend file-type entry

If the card needs an icon in the file browser, register it in `src/frontend/src/file-types/builtins.tsx`:

```ts
registerFileType({ type: "my-thing" }, { listUI: { icon: CardIcon } });
```

A card type that wants its own list row — a thumbnail, a badge — writes a
component beside its schema, as `src/schemas/my-thing.list-entry.tsx`. It takes
`ListProps<MyThingSummaryAttrs>`, so what the schema's `summarize` returns and
what the component reads cannot drift. `image.list-entry.tsx` is the worked
example.

A `*.list-entry.tsx` file is frontend code living in the schemas tree, and the
build fences it as such: it may reach the schemas, core and cards trees by
`import type` only (values come from `src/frontend/` and `src/shared/`), no
backend module may import it, and the backend tsconfig excludes it. Register it
in `builtins.tsx` — it does not register itself:

```ts
import { MyThingListEntry } from "@schemas/my-thing.list-entry";

registerFileType({ type: "my-thing" }, {
  listUI: { icon: CardIcon, ListComponent: MyThingListEntry },
});
```

## Adding a field

Every field a schema adds costs something: agents fill it in because it is
there, and readers expect it to mean something. Before adding one:

1. **Name the consumer.** The same change adds the query, UI surface, or code
   that reads the field. A field nothing reads is not added.
2. **Don't use a reserved name.** Global field names (`title`, `contains`, …)
   and the banned names `status`, `created`, `summary`, `date`, `modified` and
   `source` are rejected: `reservedFieldProblems` (`src/cards/reserved-fields.ts`)
   fails the built-in registry test (`test/cards/reserved-fields.doctest.md`)
   and gives box-local schemas a `box-schema-fields` health warning. Each
   message says what to write instead. The one allowed redeclaration is
   `title: z.string()`, which makes the title required.
   A box moves its cards off a reserved name with a field map and
   `bbx migrate-fields` (`src/core/card-fields/map.ts`; the box schema doc
   shows the map format).
3. **Record the fact itself, not a lifecycle.** The result (`transcript`), the
   failure (`transcription-error`), or a named boolean (`archived: true`),
   not an enum a writer has to remember to move.
4. **Times belong to media, external data, or the subject.** When a card was
   written is git's job. A capture time goes on the media reference. Data
   copied from an external system goes under a key named for that system
   (`email:`, `drive:`, `exif:`). A date that is part of the subject (when a
   bill is due) is a date entry, `DateEntrySchema` from `beebox/cards`
   (`src/cards/date-entry.ts`): `{ value, kind?, end?, note? }`, with `value`
   and `end` in ISO 8601 at the precision known (`1974`, `1974-06`,
   `1974-06-02`, or a datetime with an offset). One such date is a field
   named for what it is (`due: DateEntrySchema`); several go in
   `dates: z.array(DateEntrySchema)` with a `kind` each (`due`, `filed`,
   `starts`). record's `dates` uses it with `value` left free text, for
   transcribed dates ISO 8601 cannot state (`1970s`).
5. **Don't do a global field's job.** No per-type title or summary field. To
   derive a title from a data field (an email's subject, a person's name),
   return it from `summarize`; a card's own `title:` still wins.
6. **`description` means what the card's subject is or does**, for someone
   who has not opened it: what an image shows, what a procedure does, what a
   record's object is. `contains` is different: what the card holds. Narrow
   `description` for a type only when necessary.
7. **Pointers are `{ ref }` or `{ href }`.** A field that names a card, a file,
   or a URL never holds a bare string.

## Mutating an Existing Frontmatter Card

When code needs to update a frontmatter card on disk (e.g. setting `archived: true`), use `splitCardContent` + `yaml`:

```ts
import { splitCardContent } from "../exports/cards.js";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const content = await fs.readFile(absPath, "utf-8");
const split = splitCardContent(content);
const fields = parseYaml(split.frontmatterText) as MyThingFields;
fields.archived = true;
await fs.writeFile(absPath, `---\n${stringifyYaml(fields)}---\n${split.body}`);
```

For typed reads, use `parseCardText({content, source, schemas: createCardSchemaMap()})` — it validates against the schema and returns `{schema, fields, rawBody, contentType}`. See `src/core/commands/answer.ts` for a worked example.

## How Agent Discovery Works

1. `bbx init` or `bbx wakeup` calls `generateDocs(boxRoot)`
2. `generateDocs()` reads `cardSchemas` from `registry.ts` (and a box's own schemas through `loadBoxSchemas`)
3. For each schema with an `instructions` string, it writes `card-<type>.md` — to `node_modules/beebox/box-docs/` for a built-in schema, to `_content/docs/generated/` for a box-local one
4. The agent guide (`.beebox/agent-guide.md`) lists all card types and links to their docs
5. The agent guide is `@`-included in `CLAUDE.md`, so agents always see the card type list
6. Agents read `card-<type>.md` on demand for detailed instructions, from whichever of those two locations holds it

## Verification Checklist

After implementing:

1. `pnpm typecheck` — TypeScript clean
2. `pnpm lint` — ESLint clean
3. `bbx init <box>` — creates storage directory (if added), generates docs
4. `bbx create <box>/path/Name.my-thing.card -t my-thing title="..."` — template emits valid YAML
5. `bbx validate <box>/path/Name.my-thing.card` — validates
6. Check `<box>/node_modules/beebox/box-docs/card-my-thing.md` exists and has your instructions
7. Check `<box>/.beebox/agent-guide.md` lists the new type

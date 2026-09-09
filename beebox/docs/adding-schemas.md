# Adding a New Card Schema

How to add a new card type to beebox. Reference: `src/schemas/briefing.tsx` (frontmatter with body) or `src/schemas/intake-job.tsx` (frontmatter, no body) for the current format. The older XML form (`element()` + child element schemas) is still used by capture-session only (its transcript is ordered mixed content) — see that file if your card has interleaved inline content. For new card types, default to the frontmatter form below.

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
import { body, cardSchema, type CardSchema } from "../cards/index.js";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

export const MyThingStatus = z.enum(["draft", "final"]);
export type MyThingStatusType = z.infer<typeof MyThingStatus>;

const NoteEntry = z.object({
  text: z.string(),
  added: z.string().datetime({ offset: true }).optional(),
});

export const MyThingSchema: CardSchema = cardSchema("my-thing", {
  fields: {
    status: MyThingStatus.default("draft"),
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
  status: MyThingStatusType;
  notes?: Array<{ text: string; added?: string }>;
  body: string;  // omit if no body
}

export function createMyThingTemplate(options: { title: string }): string {
  const fields: Record<string, unknown> = {
    type: "my-thing",
    status: "draft",
    title: options.title,
  };
  return `---\n${stringifyYaml(fields)}---\n`;
}
```

Key patterns:
- `cardSchema(type, { fields, instructions? })` is the entry point. `fields` is a flat object of Zod validators; nest with `z.object` / `z.array` as needed.
- Every schema automatically gets seven optional frontmatter fields — `title`, `contains`, `contains-evidence`, `todos`, `symbol`, `prominence`, and `theme` (`GLOBAL_CARD_FIELDS` in `src/cards/schema.ts`; the docblock there describes each) — don't redeclare them in `fields` or in your `*Fields` interface unless you need to override their default (e.g. making `title` required). `contains` is the field agents should populate: a one-sentence summary that's the prime retrieval field for search and listings (it's boosted in ranking — see `src/core/search/query.ts`). `prominence` (`entry-point` | `primary` | `background`) is who a card is for — absent means the type's default level, which you can set with `cardSchema`'s own `prominence` option (`src/shared/prominence.ts`; `category: "system"` implies `background` unless you say otherwise). `theme: { name, stock? }` selects presentation independently of the card's view; a type can prefer one with `cardSchema`'s `theme` option. The worked example above still sets `title` in `createMyThingTemplate()`, which is fine — templates can populate a global field without the schema redeclaring it.
- Cards also accept the optional `theme: {name, stock?}` presentation choice. It is catalog-validated against the built-in theme IDs and stocks; see [`docs/box/card-themes.md`](box/card-themes.md) before adding a type preference with `cardSchema`'s `theme` option. Theme is a presentation override, not a new view or a replacement for the card's type fields.
- `body(z.string())` declares a markdown body field — it must be named `body` (enforced; one vocabulary across all card types). Omit to declare a body-less card (then any non-empty body errors on load).
- The `type` field in YAML is the discriminator — the loader uses it to look up the schema. Templates must emit it.
- Refs live in the YAML as either `{ref: "..."}` objects or strings in obvious places (e.g. `participants: [{ref: "people/..."}]`). The validator's ref-walker finds them by walking for `ref:` keys.
- Avoid `?: T | undefined` in `*Fields` interfaces — use `?: T` and spread conditionally at call sites. Zod recursive types are the exception (they need the explicit `| undefined`).
- The `instructions` string is what agents see — make it thorough.

#### Validation beyond Zod — the `validate` hook

When a card type needs a rule Zod field types can't express — a cross-field
constraint, a format refinement on a string, or validation of the body's parsed
structure — put it in a **`validate` hook on the schema**, *not* in a branch of
`src/core/card-lint.ts`. The hook co-locates the rule with the schema that
defines the type, and card-lint dispatches it generically.

```ts
import { cardSchema, type CardSchema, type LintIssue } from "../cards/index.js";

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
[`health-checks.md`](health-checks.md#template-updates-a-fix-that-never-reached-the-box).

It is deliberately a **field list, not a `merge(box, upstream)` callback**. The
judgement that matters — "is this box on unmodified old stock, or did the
boxholder edit the definition?" — needs the last-shipped hash, which lives in
the version tracker (`_config/template-versions.json`), not in the two card
texts. A free callback couldn't see that and would have to either clobber real
edits or freeze old stock. Naming which keys are *state* lets the tracker keep
making that call correctly. (Implementation: `boxOwnedFields` on
`installTemplateFile`, `src/core/install-template-file.ts`.)

### 2. Register in `src/schemas/registry.ts`

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

(If you're adding a legacy XML schema instead, add it to `schemas[]` and `getCardTypes()` picks it up via `s.tagName` rather than `s.type`.)

### 3. Register in `src/schemas/index.ts`

```ts
// Type
export type { MyThingFields, MyThingStatusType } from "./my-thing.js";

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

If the card type has its own storage location, add it to `BOX_DIRS` in `src/lib/paths.ts`:

```ts
export const BOX_DIRS = {
  // ...
  mythings: "_content/mythings",
};
```

`bbx init` iterates `Object.values(BOX_DIRS)` and creates each directory automatically.

### 6. (Optional) Frontend file-type entry

If the card needs an icon or a custom list-component in the file browser, register it in `src/frontend/src/file-types/builtins.tsx`:

```ts
registerFileType({ type: "my-thing" }, { icon: CardIcon });
```

## Mutating an Existing Frontmatter Card

When code needs to update a frontmatter card on disk (e.g. setting `status: answered` on a question), use `splitCardContent` + `yaml`:

```ts
import { splitCardContent } from "../cards/index.js";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const content = await fs.readFile(absPath, "utf-8");
const split = splitCardContent(content);
const fields = parseYaml(split.frontmatterText) as MyThingFields;
fields.status = "final";
await fs.writeFile(absPath, `---\n${stringifyYaml(fields)}---\n${split.body}`);
```

For typed reads, use `parseCardText({content, source, schemas: createCardSchemaMap()})` — it validates against the schema and returns `{schema, fields, rawBody, contentType}`. See `src/core/commands/answer.ts` for a worked example.

## How Agent Discovery Works

1. `bbx init` or `bbx wakeup` calls `generateDocs(boxRoot)`
2. `generateDocs()` reads both `schemas` (XML) and `cardSchemas` (frontmatter) from `registry.ts`
3. For each schema with an `instructions` string, it writes `card-<type>.md` — to `node_modules/beebox/box-docs/` for a built-in schema, to `_content/docs/generated/` for a box-local one
4. The agent guide (`.beebox/agent-guide.md`) lists all card types and links to their docs
5. The agent guide is `@`-included in `CLAUDE.md`, so agents always see the card type list
6. Agents read `card-<type>.md` on demand for detailed instructions, from whichever of those two locations holds it

## Verification Checklist

After implementing:

1. `npm run typecheck` — TypeScript clean
2. `npm run lint` — ESLint clean
3. `bbx init <box>` — creates storage directory (if added), generates docs
4. `bbx create <box>/path/Name.my-thing.card -t my-thing title="..."` — template emits valid YAML
5. `bbx validate <box>/path/Name.my-thing.card` — validates
6. Check `<box>/node_modules/beebox/box-docs/card-my-thing.md` exists and has your instructions
7. Check `<box>/.beebox/agent-guide.md` lists the new type

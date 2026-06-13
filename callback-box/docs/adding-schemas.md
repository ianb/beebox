# Adding a New Card Schema

How to add a new card type to callback-box. Reference: `src/schemas/briefing.tsx` (frontmatter with body) or `src/schemas/intake-job.tsx` (frontmatter, no body) for the current format. The older XML form (`element()` + child element schemas) is still used by guide, recipe, procedure, procedure-run, capture-session, and landmark — see those files only if your card has Markdoc-shaped inline content. For new card types, default to the frontmatter form below.

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
import { body, cardSchema, type CardSchema } from "cardworks";
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
    title: z.string(),
    notes: z.array(NoteEntry).optional(),
    body: body(z.string()),  // omit this line if the card has no prose body
  },
  instructions: `# My Thing Cards

Instructions for agents on how to handle this card type.
This becomes docs/generated/card-my-thing.md in boxes.

Include:
- What each frontmatter field means
- Whether the body is required and what goes there
- Where cards should be stored
- Any special conventions`,
});

export interface MyThingFields {
  type: "my-thing";
  status: MyThingStatusType;
  title: string;
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
- `body(z.string())` declares a markdown body field — it must be named `body` (enforced; one vocabulary across all card types). Omit to declare a body-less card (then any non-empty body errors on load).
- The `type` field in YAML is the discriminator — the loader uses it to look up the schema. Templates must emit it.
- Refs live in the YAML as either `{ref: "..."}` objects or strings in obvious places (e.g. `participants: [{ref: "people/..."}]`). The validator's ref-walker finds them by walking for `ref:` keys.
- Avoid `?: T | undefined` in `*Fields` interfaces — use `?: T` and spread conditionally at call sites. Zod recursive types are the exception (they need the explicit `| undefined`).
- The `instructions` string is what agents see — make it thorough.

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
  description: "A my-thing card — short description for `cb create -t`",
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

If the card type has its own storage location, add it to `BOX_DIRS` in `src/cli/lib/paths.ts`:

```ts
export const BOX_DIRS = {
  // ...
  mythings: "store/mythings",
};
```

`cb init` iterates `Object.values(BOX_DIRS)` and creates each directory automatically.

### 6. (Optional) Frontend file-type entry

If the card needs an icon or a custom list-component in the file browser, register it in `src/frontend/src/file-types/builtins.tsx`:

```ts
registerFileType({ tagName: "my-thing" }, { icon: CardIcon });
```

## Mutating an Existing Frontmatter Card

When code needs to update a frontmatter card on disk (e.g. setting `status: answered` on a question), use `splitCardContent` + `yaml`:

```ts
import { splitCardContent } from "cardworks";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const content = await fs.readFile(absPath, "utf-8");
const split = splitCardContent(content);
const fields = parseYaml(split.frontmatterText) as MyThingFields;
fields.status = "final";
await fs.writeFile(absPath, `---\n${stringifyYaml(fields)}---\n${split.body}`);
```

For typed reads, use `parseCardText({content, source, schemas: createCardSchemaMap()})` — it validates against the schema and returns `{schema, fields, rawBody, contentType}`. See `src/core/commands/answer.ts` for a worked example.

## How Agent Discovery Works

1. `cb init` or `cb wakeup` calls `generateDocs(boxRoot)`
2. `generateDocs()` reads both `schemas` (XML) and `cardSchemas` (frontmatter) from `registry.ts`
3. For each schema with an `instructions` string, it writes `docs/generated/card-<type>.md`
4. The agent guide (`.callback-box/agent-guide.md`) lists all card types and links to their docs
5. The agent guide is `@`-included in `CLAUDE.md`, so agents always see the card type list
6. Agents read `docs/generated/card-<type>.md` on demand for detailed instructions

## Verification Checklist

After implementing:

1. `npm run typecheck` — TypeScript clean
2. `npm run lint` — ESLint clean
3. `cb init <box>` — creates storage directory (if added), generates docs
4. `cb create <box>/path/Name.my-thing.card -t my-thing title="..."` — template emits valid YAML
5. `cb validate <box>/path/Name.my-thing.card` — validates
6. Check `<box>/docs/generated/card-my-thing.md` exists and has your instructions
7. Check `<box>/.callback-box/agent-guide.md` lists the new type

# Adding a New Card Schema

How to add a new card type to callback-box. Follow the recipe schema (`src/schemas/recipe.tsx`) as a reference.

## When to Create a New Card Type

Create a new schema when:
- The data has a distinct structure that doesn't fit `record` or `memo`
- You need specific validation (typed attributes, required children)
- The agent needs domain-specific instructions for handling the data

If it's just a generic captured thing, use `record` instead.

## Files to Touch

Adding a schema touches 5 files, plus creates 1 new one:

### 1. Create the Schema File

`src/schemas/<name>.tsx` (use `.tsx` if you need a JSX template, `.ts` otherwise)

```tsx
import { element, serialize } from "cardworks";
import { z } from "zod";

// Define child elements
export const MyThingTitle = element("title", {
  text: z.string(),
});

export const MyThingNotes = element("notes", {
  text: z.string().optional(),
});

// Define root element
export const MyThingSchema = element("my-thing", {
  attrs: {
    status: z.enum(["draft", "final"]).optional(),
  },
  children: z.array(
    z.union([MyThingTitle, MyThingNotes])
  ),
  instructions: `# My Thing Cards

Instructions for agents on how to handle this card type.
This becomes docs/generated/card-my-thing.md in boxes.

Include:
- What each field means
- Where cards should be stored
- Any special conventions`,
});

export type MyThing = z.infer<typeof MyThingSchema>;

// Template function (uses JSX — requires .tsx extension)
export function createMyThingTemplate(options: {
  title: string;
}): string {
  const thing = (
    <my-thing>
      <title>{options.title}</title>
      <notes />
    </my-thing>
  );
  return serialize(thing) + "\n";
}
```

Key patterns:
- Each XML element gets its own `element()` call with a Zod schema
- Use `z.coerce.number()` for numeric attributes (XML attrs are always strings)
- `text: z.string().optional()` for elements that can be empty
- The `instructions` string on the root element is what agents see — make it thorough
- Template functions return XML strings via `serialize(jsx) + "\n"`

### 2. Register in `src/schemas/registry.ts`

```ts
import { RecipeSchema } from "./recipe.js";

export const schemas: ElementSchema[] = [
  // ...existing schemas...
  RecipeSchema,  // add to array
];

// Add re-export at bottom:
export { RecipeSchema } from "./recipe.js";
```

### 3. Register in `src/schemas/index.ts`

Add the schema, type, and template function to the three re-export sections:

```ts
// Schema
RecipeSchema,

// Type
export type { Recipe } from "./recipe.js";

// Template
export { createRecipeTemplate } from "./recipe.js";
```

### 4. Register Template in `src/schemas/templates.ts`

```ts
import { createRecipeTemplate } from "./recipe.js";

registerTemplate({
  name: "recipe",
  description: "A recipe card with ingredients, steps, and scaling support",
  cardTypes: ["recipe"],
  argsSchema: z.object({
    title: z.string().describe("Recipe name"),
  }),
  generate: (args) => {
    // Note: use this pattern for optional args with exactOptionalPropertyTypes
    const templateArgs: Parameters<typeof createRecipeTemplate>[0] = {
      title: args.title,
    };
    if (args.description) templateArgs.description = args.description;
    return createRecipeTemplate(templateArgs);
  },
});
```

**Gotcha:** The project uses `exactOptionalPropertyTypes: true` in tsconfig. You can't pass `undefined` to optional properties directly. Use the `const templateArgs = { required }; if (val) templateArgs.optional = val;` pattern.

### 5. Add to `src/core/commands/create.ts`

The `create` command has its own hardcoded template maps (separate from `templates.ts`). Add entries to both:

```ts
import { createRecipeTemplate } from "../../schemas/recipe.js";

// In TEMPLATES:
recipe: (args) =>
  createRecipeTemplate({
    title: args.content ?? "Untitled Recipe",
  }),

// In TYPE_TO_TEMPLATE:
recipe: "recipe",
```

### 6. (Optional) Add a Storage Directory

If the card type has its own storage location, add it to `BOX_DIRS` in `src/cli/lib/paths.ts`:

```ts
export const BOX_DIRS = {
  // ...
  recipes: "store/recipes",
  // ...
};
```

And add a row to the directory layout table in `src/core/generate-docs.ts`:

```ts
"| `store/recipes/` | Recipe collection (subdirectories for organization) |",
```

Adding to `BOX_DIRS` is sufficient — `cb init` iterates `Object.values(BOX_DIRS)` and creates each directory automatically.

## How Agent Discovery Works

1. `cb init` or `cb wakeup` calls `generateDocs(boxRoot)`
2. `generateDocs()` reads the `schemas` array from `registry.ts`
3. For each schema with an `instructions` string, it writes `docs/generated/card-<tagname>.md`
4. The agent guide (`.callback-box/agent-guide.md`) lists all card types and links to their docs
5. The agent guide is `@`-included in `CLAUDE.md`, so agents always see the card type list
6. Agents read `docs/generated/card-<tagname>.md` on demand for detailed instructions

## Verification Checklist

After implementing:

1. `npm run build` — compiles without errors
2. `cb init <box>` — creates storage directory (if added), generates docs
3. `cb create <box>/path/Name.my-type.card` — template works
4. `cb validate <box>/path/Name.my-type.card` — validates
5. Check `<box>/docs/generated/card-my-type.md` exists and has your instructions
6. Check `<box>/.callback-box/agent-guide.md` lists the new type

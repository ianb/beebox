# Recipe

## What it is

The recipe plugin is for recipes a box can scale. It ships one card base and
one view:

- `recipe`: a recipe card. Identity is in the frontmatter (`title`,
  `description`, `sources`, `tags`, `hero-image`); structure is in the body,
  written with six Markdoc tags: `yield`, `ingredient`, `step`,
  `substitution`, `subrecipe` and `recipe-section`.
- The `recipe` view renders the body with a scale control (half, 1x, 2x and
  more). Ingredient amounts and the yield scale together; steps are numbered;
  a `subrecipe` links to its card.
- A `recipe` card template for `bbx create`, seeded with a yield, one
  ingredient and one step.

Nothing here runs until a box activates the plugin and writes the stubs below.
A box without them has no `recipe` type; recipe cards in such a box are
reported by the `plugin-type-unprovided` health check.

## Setup

Three steps, all box files. Commit them.

1. Activate the plugin in `_config/box.json`:

`<box>/_config/box.json`:

```json
{
  "plugins": ["recipe"]
}
```

Keep the box's other settings; add the `plugins` key beside them.

2. Write the schema stub. It completes the plugin's base with the default
type name and re-exports the card template.

`<box>/src/schemas/recipe.ts`:

```ts
import { cardSchema } from "beebox/cards";
import recipe from "beebox/plugins/recipe";
export { template } from "beebox/plugins/recipe";
export default cardSchema("recipe", recipe.schemas["recipe"]);
```

To add a field, wrap the base with `extendSchema` from `beebox/cards`:
`cardSchema("recipe", extendSchema(recipe.schemas["recipe"], { fields: { rating: z.number().optional() } }))`,
with `z` from `beebox/schema`. A field the base already declares is an error.

3. Write the view stub. The view finds the card it renders by `params.path`
among the cards its `dependencies` globs select, so the glob is required.

`<box>/src/views/recipe.tsx`:

```tsx
export { default } from "beebox/plugins/recipe/view";
export const rendersCardTypes = ["recipe"];
export const dependencies = ["**/*.recipe.card"];
```

The doctest `test/plugins/recipe/plugin.setup.test.ts` writes these exact
files into a temp box and validates a recipe card that uses every tag, so this
section is what loads.

## Conventions

- The six tags are valid only in a recipe body. Elsewhere they render as
  authored text, and `bbx validate` warns `Undefined tag`.
- A tag's `amount` takes `1/4`, `1 1/2` or a range like `2-3`. Keep the
  author's units and wording; the view scales only `amount`.
- The view's CSS classes start with `bbx-recipe-`.
- Extend the base with `extendSchema` from `beebox/cards`, not by copying it.

## Migration

For a box created on an engine where `recipe` was built in:

1. List the plugin in `_config/box.json` and write the two stubs (Setup).
2. Run `bbx validate`.

No card changes: the body vocabulary and the frontmatter are the same.
`plugin-type-unprovided` in the health report is the prompt until the stubs
exist.

## Uninstall

Remove `recipe` from `plugins` in `_config/box.json` and commit. The stubs
stay as box code and keep compiling, so existing cards still validate. To
remove the type as well, delete the stubs; recipe cards then show as unknown
types in `bbx validate` until they are moved or deleted.

Tell the person what stays: their recipe cards are untouched; the scaling view
is gone if the view stub is deleted.

/**
 * Recipe card schema — Phase-2 frontmatter + Markdoc-annotated body.
 *
 * Was previously an XML schema with `<ing>`, `<step>`, `<section>`, etc.
 * Now: identity in frontmatter (title, description, source, tags, hero
 * image), structure in the body via the recipe Markdoc vocabulary
 * (`{% ingredient %}`, `{% step %}`, `{% yield %}`,
 * `{% substitution %}`, `{% subrecipe %}`, `{% recipe-section %}`). See
 * `markdoc-tags-design.md` Track 1 for the migration rationale.
 *
 * The frontend renderer (`RecipeView`) wraps the body in a container
 * that provides scaling context + CSS step-counter resets; otherwise
 * it just renders the body via the shared Markdown component.
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { body, cardSchema, type CardSchema } from "../cards/index.js";

export const RecipeSchema: CardSchema = cardSchema("recipe", {
  fields: {
    title: z.string(),
    description: z.string().optional(),
    source: z.string().optional(),
    tags: z.array(z.string()).optional(),
    "hero-image": z.string().optional(),
    body: body(z.string()),
  },
  instructions: `# Recipe Cards

Recipes live in \`store/recipes/\`. Use subdirectories for organization
(e.g., \`store/recipes/italian/\`, \`store/recipes/desserts/\`).

## Frontmatter

- \`title:\` — required. Recipe name.
- \`description:\` — optional prose.
- \`source:\` — optional. Cookbook, person, URL.
- \`tags:\` — optional array of strings.
- \`hero-image:\` — optional path to a representative image (relative
  to the recipe card's attach scope, e.g. \`attach/finished.jpg\`).

## Body

Markdoc-annotated markdown. Vocabulary:

- \`{% yield amount="4" %}4 servings{% /yield %}\` — the scaling base.
  \`amount\` is the number the recipe view multiplies against when
  scaling; the body text is human-readable.
- \`{% ingredient amount="2" unit="cups" %}all-purpose flour{% /ingredient %}\`
  — inline (within a step's prose) or block (typically inside a list
  item). The frontend recipe view scales the \`amount\` attribute
  using a \`Fraction\` parser, so values like \`1/4\`, \`1 1/2\`,
  \`2-3\` (range) all work.
- \`{% step %}First, do this thing.{% /step %}\` — one step of the
  recipe. Numbered automatically by the recipe view (CSS counter).
- \`{% substitution for="buttermilk" %}Use milk + 1 tbsp lemon
  juice.{% /substitution %}\` — a substitution. \`for\` names the
  ingredient or step being substituted.
- \`{% subrecipe ref="/store/recipes/sauces/Marinara.recipe.card" %}
  Make a half batch.{% /subrecipe %}\` — link to a sibling recipe.
  \`ref\` is a card path — see PROVENANCE for ref semantics.
- \`{% recipe-section name="Sauce" %}\` — block. Groups a sub-recipe
  within a recipe (e.g. sauce + pasta in one card). Optional.

Free-form markdown headings (\`## Notes\`, \`## Equipment\`) work
alongside the tags for sections that don't need structure.

## File naming

\`store/recipes/Recipe_Name.recipe.card\``,
});

export interface RecipeFields {
  type: "recipe";
  title: string;
  description?: string;
  source?: string;
  tags?: string[];
  "hero-image"?: string;
  body: string;
}

/**
 * Template for creating a recipe card. Seeds yield + headings + a
 * single ingredient/step as a starting shape.
 */
export function createRecipeTemplate(options: {
  title: string;
  description?: string;
  servings?: number;
}): string {
  const fields: Record<string, unknown> = { title: options.title };
  if (options.description !== undefined && options.description !== "") {
    fields["description"] = options.description;
  }
  const servings = options.servings ?? 4;
  const yamlText = stringifyYaml(fields);
  const body = `{% yield amount="${servings}" %}${servings} servings{% /yield %}

## Ingredients

- {% ingredient amount="1" unit="cup" %}ingredient name{% /ingredient %}

## Steps

{% step %}First step here.{% /step %}
`;
  return `---\n${yamlText}---\n${body}`;
}

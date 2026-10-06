/**
 * Recipe card schema — Phase-2 frontmatter + Markdoc-annotated body.
 *
 * Was previously an XML schema with `<ing>`, `<step>`, `<section>`, etc.
 * Now: identity in frontmatter (title, description, sources, tags, hero
 * image), structure in the body via the recipe Markdoc vocabulary
 * (`{% ingredient %}`, `{% step %}`, `{% yield %}`,
 * `{% substitution %}`, `{% subrecipe %}`, `{% recipe-section %}`). See
 * `markdoc-tags-plan.md` Track 1 for the migration rationale.
 *
 * The frontend renderer (`RecipeView`) wraps the body in a container
 * that provides scaling context + CSS step-counter resets; otherwise
 * it just renders the body via the shared Markdown component.
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { body, cardSchema, type InferCardFields } from "../exports/cards.js";
import { LabeledSourcesEntrySchema } from "../cards/sources-entry.js";

/**
 * A representative image — exactly one of `ref` (into the recipe's attach scope,
 * e.g. `attach/finished.jpg`) or `href` (an external URL).
 */
const RecipeHeroImage = z
  .object({
    ref: z.string().optional(),
    href: z.string().optional(),
  })
  .refine((h) => (h.ref === undefined) !== (h.href === undefined), {
    message: "hero-image needs exactly one of ref / href",
  });

export const RecipeSchema = cardSchema("recipe", {
  brief: "A scalable recipe",
  description: "A recipe with scaling-aware ingredients, steps, and substitutions via the recipe Markdoc tags",
  category: "authored",
  fields: {
    title: z.string(),
    description: z.string().optional(),
    // Where the recipe came from: a page, a card, or a named cookbook or person.
    sources: z.array(LabeledSourcesEntrySchema).optional(),
    tags: z.array(z.string()).optional(),
    "hero-image": RecipeHeroImage.optional(),
    body: body(z.string()),
  },
  instructions: `# Recipe Cards

Recipes live in \`_content/recipes/\`. Organize with subdirectories only if
the user wants that — don't impose a taxonomy.

## Frontmatter

- \`title:\` — required. Recipe name.
- \`description:\` — optional prose.
- \`sources:\` — optional. Where the recipe came from, as a list of entries.
  Each entry has one of \`href\` (an external URL) or \`ref\` (a card, e.g. a
  frozen \`*.webpage.card\`), and optional \`label\` display text. A source
  with nothing to point at (a cookbook, a person) is a \`label\` alone. E.g.
  \`sources: [{label: "The Kitchen"}]\` or
  \`sources: [{href: "<the recipe's URL>", label: "Serious Eats"}]\`.
- \`tags:\` — optional array of strings.
- \`hero-image:\` — optional representative image, as an object with
  exactly one of \`ref\` (into this card's attach scope, e.g.
  \`{ref: "attach/finished.jpg"}\`) or \`href\` (an external URL).

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
- \`{% subrecipe ref="/_content/recipes/sauces/Marinara.recipe.card" %}
  Make a half batch.{% /subrecipe %}\` — link to a sibling recipe.
  \`ref\` is a card path — see PROVENANCE for ref semantics.
- \`{% recipe-section name="Sauce" %}\` — block. Groups a sub-recipe
  within a recipe (e.g. sauce + pasta in one card). Optional.

Free-form markdown headings (\`## Notes\`, \`## Equipment\`) work
alongside the tags for sections that don't need structure.

## Fidelity

When you structure a recipe from something the user wrote or saved, keep
their measurements and wording exactly as given: \`unit="tbsp"\` and body
text "1 tbsp", never "1 T"; "1/2 cup" stays "1/2 cup", not "½ c".
Abbreviating units silently is a real cooking hazard ("1 T" vs "1 t" is a
3× error), and any silent edit to their quantities undermines trust in the
whole card. Convert or normalize only when asked, and say that you did.

## File naming

\`_content/recipes/Recipe_Name.recipe.card\``,
});

export type RecipeFields = InferCardFields<typeof RecipeSchema>;

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
  const bodyText = `{% yield amount="${servings}" %}${servings} servings{% /yield %}

## Ingredients

- {% ingredient amount="1" unit="cup" %}ingredient name{% /ingredient %}

## Steps

{% step %}First step here.{% /step %}
`;
  return `---\n${yamlText}---\n${bodyText}`;
}

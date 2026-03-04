/** @jsxImportSource cardworks/jsx */
/**
 * Recipe card schema — structured recipes with multi-section support,
 * inline ingredient references, and scaling.
 *
 * Recipes live in store/recipes/ with optional subdirectories for organization.
 */

import { element, serialize } from "cardworks";
import { z } from "zod";

export const RecipeTitle = element("title", {
  text: z.string(),
});

export const RecipeDescription = element("description", {
  text: z.string(),
});

export const RecipeYield = element("yield", {
  attrs: {
    /** Numeric base for scaling (e.g., 4 for "4 servings") */
    amount: z.coerce.number(),
  },
  text: z.string(),
});

export const RecipeSource = element("source", {
  text: z.string(),
});

export const RecipeImage = element("image", {
  attrs: {
    src: z.string(),
  },
});

export const RecipeTag = element("tag", {
  text: z.string(),
});

export const RecipeTags = element("tags", {
  children: z.array(RecipeTag).optional(),
});

export const RecipeNotes = element("notes", {
  text: z.string().optional(),
});

export const RecipeIng = element("ing", {
  attrs: {
    /** Amount for scaling — can be a number or fraction like "1/4" */
    amount: z.string().optional(),
    /** Freeform unit: "cups", "28oz can", "cloves", etc. */
    unit: z.string().optional(),
  },
  text: z.string(),
});

export const RecipeIngredients = element("ingredients", {
  children: z.array(RecipeIng).optional(),
});

export const RecipeStep = element("step", {
  text: z.string(),
});

export const RecipeSteps = element("steps", {
  children: z.array(RecipeStep).optional(),
});

export const RecipeSection = element("section", {
  attrs: {
    /** Section name (e.g., "Sauce", "Pasta"). Omit for single-section recipes. */
    name: z.string().optional(),
  },
  children: z.array(
    z.union([RecipeNotes, RecipeIngredients, RecipeSteps])
  ),
});

/**
 * Recipe card schema.
 *
 * Example:
 * ```xml
 * <recipe>
 *   <title>Pasta alla Norma</title>
 *   <description>A classic Sicilian pasta with fried eggplant and ricotta salata.</description>
 *   <yield amount="4">4 servings</yield>
 *   <source>Marcella Hazan, Essentials of Classic Italian Cooking</source>
 *   <image src="norma.jpg" />
 *   <tags><tag>pasta</tag><tag>sicilian</tag></tags>
 *   <notes>The eggplant can be grilled instead of fried.</notes>
 *
 *   <section name="Sauce">
 *     <notes>This sauce works on its own too.</notes>
 *     <ingredients>
 *       <ing amount="1" unit="28oz can">San Marzano tomatoes</ing>
 *       <ing amount="3" unit="cloves">garlic</ing>
 *       <ing>fresh basil</ing>
 *     </ingredients>
 *     <steps>
 *       <step>Sauté @{garlic} in @{olive oil}, add crushed @{San Marzano tomatoes}.</step>
 *       <step>Add @{eggplant}{1 cup} to the sauce with torn @basil.</step>
 *     </steps>
 *   </section>
 * </recipe>
 * ```
 */
export const RecipeSchema = element("recipe", {
  children: z.array(
    z.union([
      RecipeTitle,
      RecipeDescription,
      RecipeYield,
      RecipeSource,
      RecipeImage,
      RecipeTags,
      RecipeNotes,
      RecipeSection,
    ])
  ),
  instructions: `# Recipe Cards

Recipes live in \`store/recipes/\`. Use subdirectories for organization (e.g., \`store/recipes/italian/\`, \`store/recipes/desserts/\`).

## Structure

- **<title>**: Recipe name.
- **<description>**: Prose description — what the dish is, its origin, when to make it.
- **<yield amount="N">**: Scaling base. The \`amount\` attribute is the number used for multiplication. Text is human-readable: "4 servings", "2 loaves", "about 3 cups".
- **<source>**: Attribution — cookbook, person, URL.
- **<image src="...">**: Path to an image file (relative to the card).
- **<tags>**: Categorization tags.
- **<notes>**: Free-form notes. Can appear at top level or inside a section.
- **<section name="...">**: Groups ingredients and steps together. Use multiple sections for multi-part recipes (e.g., sauce + pasta). Omit the \`name\` attribute for simple single-section recipes.

## Ingredients

Inside \`<ingredients>\`, each \`<ing>\` has:
- \`amount\` (string, optional) — number or fraction that gets multiplied when scaling. Supports integers, decimals, fractions ("1/4"), and mixed numbers ("1 1/2").
- \`unit\` (string, optional) — freeform: "cups", "28oz can", "cloves", "large"
- Text content is the ingredient name (and optional prep notes)

Examples:
- \`<ing amount="2" unit="cups">all-purpose flour</ing>\`
- \`<ing amount="1/4" unit="cup">olive oil</ing>\`
- \`<ing amount="1 1/2" unit="cups">sugar</ing>\`
- \`<ing amount="1" unit="28oz can">San Marzano tomatoes</ing>\`
- \`<ing>fresh basil</ing>\` (no amount — "to taste")
- \`<ing amount="3" unit="large">eggs</ing>\`

## Steps with @ References

Steps can reference ingredients with \`@\` syntax:
- \`@basil\` — single word ingredient
- \`@{ricotta salata}\` — multi-word ingredient (use braces)
- \`@{eggplant}{1 cup}\` — with step-specific quantity (freeform text)

The quantity in \`@{ingredient}{amount}\` is for this step only and is separate from the total in the \`<ing>\` list. It does not affect scaling.

## Scaling

To scale a recipe, multiply all \`<ing amount="...">\` values by \`(desired / yield.amount)\`. Ingredients without an \`amount\` attribute are "to taste" and don't scale.

## File Naming

\`store/recipes/Recipe_Name.recipe.card\``,
});

export type Recipe = z.infer<typeof RecipeSchema>;

/**
 * Template for creating a recipe card.
 */
export function createRecipeTemplate(options: {
  title: string;
  description?: string;
  servings?: number;
}): string {
  const recipe = (
    <recipe>
      <title>{options.title}</title>
      {options.description && <description>{options.description}</description>}
      <yield amount={options.servings ?? 4}>{options.servings ?? 4} servings</yield>
      <notes />
      <section>
        <ingredients>
          <ing amount={1} unit="cups">ingredient</ing>
        </ingredients>
        <steps>
          <step>First step here.</step>
        </steps>
      </section>
    </recipe>
  );
  return serialize(recipe) + "\n";
}

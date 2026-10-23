/**
 * The `recipe` card template. The plugin exports it by name beside its
 * default; a box's `src/schemas/recipe.ts` stub re-exports it, and the box
 * schema loader registers it.
 */
import { renderFrontmatterBlock, type TemplateDefinition } from "../../exports/cards.js";
import { z } from "../../exports/schema.js";

/**
 * Template for creating a recipe card. Seeds yield + headings + a
 * single ingredient/step as a starting shape.
 */
function createRecipeTemplate(options: {
  title: string;
  description?: string;
  servings?: number;
}): string {
  const fields: Record<string, unknown> = { title: options.title };
  if (options.description !== undefined && options.description !== "") {
    fields["description"] = options.description;
  }
  const servings = options.servings ?? 4;
  const bodyText = `{% yield amount="${servings}" %}${servings} servings{% /yield %}

## Ingredients

- {% ingredient amount="1" unit="cup" %}ingredient name{% /ingredient %}

## Steps

{% step %}First step here.{% /step %}
`;
  return renderFrontmatterBlock(fields, bodyText);
}

const argsSchema = z.object({
  title: z.string().describe("Recipe name"),
  description: z.string().optional().describe("What the dish is"),
  servings: z.coerce.number().optional().describe("Number of servings (default: 4)"),
});

export const template: TemplateDefinition = {
  name: "recipe",
  description: "A recipe card with ingredients, steps, and scaling support",
  cardTypes: ["recipe"],
  defaultForTypes: ["recipe"],
  argsSchema,
  generate: (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const templateArgs: Parameters<typeof createRecipeTemplate>[0] = { title: args.title };
    if (args.description) templateArgs.description = args.description;
    if (args.servings) templateArgs.servings = args.servings;
    return createRecipeTemplate(templateArgs);
  },
};

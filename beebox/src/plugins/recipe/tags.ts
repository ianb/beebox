/**
 * The recipe plugin's Markdoc vocabulary: six tags valid only in a recipe
 * body (`CardSchemaConfig.markdocTags` on the base). Replaces the legacy XML
 * recipe schema's `<ing>`, `<step>`, etc. The `ingredient` tag works inline
 * (within a step's prose) or block (as a list item); the view's scaling
 * logic reads its `amount` attribute. Each transform emits the render name
 * the view's `components` map defines (`view/tags.tsx`).
 */
import Markdoc from "@markdoc/markdoc";
import type { Schema } from "@markdoc/markdoc";

// Value named imports (`{ Tag }`) don't resolve from this CommonJS module under
// Node's ESM loader; destructure off the default import, as core.ts does.
// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { Tag } = Markdoc;

const ingredient: Schema = {
  attributes: {
    amount: { type: String },
    unit: { type: String },
  },
  transform(node, config) {
    const attrs = node.transformAttributes(config);
    return new Tag(
      node.inline ? "IngredientInline" : "IngredientBlock",
      attrs,
      node.transformChildren(config),
    );
  },
};

const step: Schema = {
  transform(node, config) {
    return new Tag("Step", node.transformAttributes(config), node.transformChildren(config));
  },
};

const recipeYield: Schema = {
  attributes: {
    amount: { type: String },
  },
  transform(node, config) {
    return new Tag("RecipeYield", node.transformAttributes(config), node.transformChildren(config));
  },
};

const substitution: Schema = {
  attributes: {
    for: { type: String },
  },
  transform(node, config) {
    // `for` is also a reserved-ish prop in some React contexts (label's
    // `htmlFor`); rename to `forIngredient` to keep the React side clean.
    const { for: forAttr, ...rest }: { for?: string; [key: string]: unknown } = node.transformAttributes(config);
    const renamed = forAttr === undefined ? rest : { ...rest, forIngredient: forAttr };
    return new Tag("Substitution", renamed, node.transformChildren(config));
  },
};

const subrecipe: Schema = {
  attributes: {
    ref: { type: String, required: true },
  },
  transform(node, config) {
    // Same `ref` → `sourceRef` rename as `source` / `key-person`.
    const { ref, ...rest }: { ref?: string; [key: string]: unknown } = node.transformAttributes(config);
    const renamed = ref === undefined ? rest : { ...rest, sourceRef: ref };
    return new Tag("Subrecipe", renamed, node.transformChildren(config));
  },
};

const recipeSection: Schema = {
  attributes: {
    name: { type: String },
  },
  transform(node, config) {
    return new Tag("RecipeSection", node.transformAttributes(config), node.transformChildren(config));
  },
};

export const recipeTags: Readonly<Record<string, Schema>> = {
  ingredient,
  step,
  yield: recipeYield,
  substitution,
  subrecipe,
  "recipe-section": recipeSection,
};

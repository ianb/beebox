/**
 * The recipe plugin: scalable recipes with ingredient, step and yield tags.
 * A box activates it by naming `recipe` in `_config/box.json` `plugins` and
 * writing the stubs in `README.md` (Setup). Published as `beebox/plugins/recipe`;
 * the view is `beebox/plugins/recipe/view`.
 */
import { definePlugin } from "../../cards/plugin-definition.js";
import { recipeBase } from "./base.js";

export default definePlugin({
  name: "recipe",
  description: "Scalable recipes with ingredient, step and yield tags",
  docs: "src/plugins/recipe/README.md",
  schemas: { recipe: recipeBase },
  views: [{ name: "recipe", rendersCardTypes: ["recipe"] }],
});

export { template } from "./template.js";

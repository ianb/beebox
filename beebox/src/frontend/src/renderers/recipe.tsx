/**
 * Recipe card renderer — registers the RecipeView component for recipe cards.
 *
 * The view itself lives in components/ so its appearance classes can sit
 * next to the rendering logic.
 */

import { RecipeView } from "../components/RecipeView";
import type { RendererEntry } from "../file-type-registry";

export const recipeRenderer: RendererEntry = {
  selector: { type: "recipe" },
  renderer: { name: "Recipe", Component: RecipeView, priority: 100 },
};

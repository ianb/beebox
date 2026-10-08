/**
 * Recipe card renderer — registers the RecipeView component for recipe cards.
 *
 * The view itself lives in components/ so its appearance classes can sit
 * next to the rendering logic.
 */

import { lazyComponent } from "../lib/lazy-component";
import type { RendererEntry } from "../file-type-registry";

export const recipeRenderer: RendererEntry = {
  selector: { type: "recipe" },
  renderer: { name: "Recipe", Component: lazyComponent(() => import("../components/RecipeView"), (m) => m.RecipeView), priority: 100 },
};

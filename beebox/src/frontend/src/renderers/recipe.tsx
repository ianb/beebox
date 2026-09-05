/**
 * Recipe card renderer — registers the RecipeView component for recipe cards.
 *
 * The view itself lives in components/ so its appearance classes can sit
 * next to the rendering logic.
 */

import { RecipeView } from "../components/RecipeView";
import { registerFileType } from "./index";

registerFileType({ type: "recipe" }, {
  renderer: { name: "Recipe", Component: RecipeView, priority: 100 },
});

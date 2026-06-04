/**
 * Commentary card renderer — registers CommentaryView for `commentary` cards.
 *
 * The view lives in components/ so its appearance classes sit next to the
 * rendering logic (same split as recipe).
 */

import { CommentaryView } from "../components/CommentaryView";
import { registerCardRenderer } from "./index";

registerCardRenderer("commentary", {
  name: "Commentary",
  Component: CommentaryView,
  priority: 100,
});

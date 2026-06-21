/**
 * Default renderer for Phase 2 (YAML frontmatter + markdown body) cards.
 *
 * Registered at priority 30 so it beats XmlRenderer (10) and TreeRenderer (20)
 * for any frontmatter card, but yields to type-specific renderers like Recipe
 * (priority 100) when one matches the card's type.
 */

import { MarkdownCardView } from "../components/MarkdownCardView";
import { registerFileRenderer } from "./index";

registerFileRenderer(
  (_path, data) => data.kind === "frontmatter",
  { name: "Card", Component: MarkdownCardView, priority: 30 },
);

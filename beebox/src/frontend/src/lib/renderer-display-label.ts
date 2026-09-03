/**
 * View-tab display labels for `RendererToggle` (`components/FileView.tsx`).
 *
 * A registered renderer's `name` is its identity — the `?view=` URL param and
 * `onSelect` argument — and never changes here. This module only maps that
 * identity to friendlier tab text (docs/plans/vocab-glossary-sweep.md Track
 * C item 8): the generic "Card" renderer shows the card's own type ("Recipe")
 * when nothing more specific is registered, or "Details" when a
 * type-specific renderer (Recipe, Concept Map, …) already claims the
 * headline slot; "Source" reads as "Original text" for card files.
 * Everything else passes through unchanged.
 */

/** Card type extracted from `Name.<type>.card`, humanized: dashes become
 *  spaces, first word capitalized ("concept-map" -> "Concept map"). */
function humanizedCardType(filePath: string): string | null {
  const base = filePath.split("/").pop();
  if (base === undefined || base === "") return null;
  const type = base.match(/\.([\da-z-]+)\.card$/i)?.[1];
  if (type === undefined) return null;
  const words = type.replace(/[_-]+/g, " ").trim();
  if (words === "") return null;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Display label for one renderer tab.
 *
 * `hasTypeSpecificRenderer` says whether a higher-priority renderer than the
 * generic "Card" one (priority 30) is registered for this file — in practice,
 * whether the sorted renderer list's first (active-priority) entry is
 * something other than "Card" (`renderers/markdown-card.tsx`'s own priority
 * comment documents the ordering this reads). When true, "Card" itself is
 * the fallback/inspection tab and reads as "Details" rather than repeating
 * the type name the active tab already shows.
 */
export function rendererDisplayLabel({
  registeredName,
  filePath,
  hasTypeSpecificRenderer,
}: {
  registeredName: string;
  filePath: string;
  hasTypeSpecificRenderer: boolean;
}): string {
  if (registeredName === "Card") {
    if (hasTypeSpecificRenderer) return "Details";
    return humanizedCardType(filePath) ?? registeredName;
  }
  if (registeredName === "Source" && filePath.endsWith(".card")) {
    return "Original text";
  }
  return registeredName;
}

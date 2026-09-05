/**
 * Helpers for data-bbx-source provenance tagging.
 *
 * See docs/data-source-tagging.md for the full convention.
 */

type SourceType = "card" | "commit" | "api" | "dir" | "session" | "schedule";

/**
 * Build `data-bbx-source` props from one or more type:identifier pairs.
 *
 * Single source:
 *   bbxSource("card", "_content/todos/Shopping.doc.card")
 *
 * Multiple sources (pass tuples):
 *   bbxSource(["card", "path1"], ["card", "path2"])
 */
export function bbxSource(
  typeOrTuple: SourceType | [SourceType, string],
  ...rest: Array<string | [SourceType, string]>
): { "data-bbx-source": string } {
  // Single source: bbxSource("card", "path")
  if (typeof typeOrTuple === "string" && rest.length === 1 && typeof rest[0] === "string") {
    return { "data-bbx-source": `${typeOrTuple}:${rest[0]}` };
  }

  // Multiple sources as tuples: bbxSource(["card", "p1"], ["card", "p2"])
  const tuples: Array<[SourceType, string]> = [];
  if (Array.isArray(typeOrTuple)) {
    tuples.push(typeOrTuple);
  }
  for (const item of rest) {
    if (Array.isArray(item)) {
      tuples.push(item);
    }
  }

  const value = tuples.map(([t, id]) => `${t}:${id}`).join(" ");
  return { "data-bbx-source": value };
}

/**
 * Build `data-bbx-source-item` props.
 *
 *   bbxSourceItem("item: Buy milk")
 */
export function bbxSourceItem(description: string): { "data-bbx-source-item": string } {
  return { "data-bbx-source-item": description };
}

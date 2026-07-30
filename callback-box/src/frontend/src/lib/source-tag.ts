/**
 * Helpers for data-cb-source provenance tagging.
 *
 * See docs/data-source-tagging.md for the full convention.
 */

type SourceType = "card" | "commit" | "api" | "dir" | "session" | "schedule";

/**
 * Build `data-cb-source` props from one or more type:identifier pairs.
 *
 * Single source:
 *   cbSource("card", "store/todos/Shopping.doc.card")
 *
 * Multiple sources (pass tuples):
 *   cbSource(["card", "path1"], ["card", "path2"])
 */
export function cbSource(
  typeOrTuple: SourceType | [SourceType, string],
  ...rest: Array<string | [SourceType, string]>
): { "data-cb-source": string } {
  // Single source: cbSource("card", "path")
  if (typeof typeOrTuple === "string" && rest.length === 1 && typeof rest[0] === "string") {
    return { "data-cb-source": `${typeOrTuple}:${rest[0]}` };
  }

  // Multiple sources as tuples: cbSource(["card", "p1"], ["card", "p2"])
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
  return { "data-cb-source": value };
}

/**
 * Build `data-cb-source-item` props.
 *
 *   cbSourceItem("item: Buy milk")
 */
export function cbSourceItem(description: string): { "data-cb-source-item": string } {
  return { "data-cb-source-item": description };
}

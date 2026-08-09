/**
 * Types for resolve-rules.mjs.
 *
 * The implementation is `.mjs` because the doctest loader that consumes it is
 * a Node module-customization hook and must stay `.mjs`; this declaration is
 * what lets TypeScript consumers (the graph builder) use it without a cast.
 */

/** Whether a specifier is relative — the only kind the rules below apply to. */
export function isRelative(specifier: string): boolean;

/**
 * The loader's narrow rule: a relative `.js` specifier whose `.ts` sibling is
 * absent and whose `.tsx` sibling exists resolves to the `.tsx` file URL.
 * Every other shape returns null, and the caller delegates onward.
 */
export function tsxOnlyFallback(specifier: string, parentURL: string | undefined): string | null;

/**
 * Every existing file a specifier could resolve to, most-preferred first.
 *
 * More than one result is meaningful: a consumer building a dependency graph
 * should treat every candidate as an edge, because over-approximating costs
 * extra work while picking wrong silently loses an edge.
 */
export function candidateFiles(
  specifier: string,
  context: { importerDir: string; aliases: Record<string, string> },
): string[];

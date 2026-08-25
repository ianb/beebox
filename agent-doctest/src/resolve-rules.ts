/**
 * Module-resolution rules shared by the doctest loader and by anything that
 * needs to reason about the same import graph without running it.
 *
 * There is exactly one authority for "what does this specifier resolve to".
 * The loader (doctest-hooks.ts) consumes the narrow rule it has always
 * applied; a static graph builder consumes the broad candidate list. Keeping
 * both on this file is what stops the two from drifting into disagreement —
 * a disagreement would show up as a selector silently pointing at the wrong
 * test, not as an error.
 *
 * This file is `.ts`, not `.mjs`: agent-doctest is not published to npm, and
 * its `exports` map ships TypeScript sources directly (see `./check` and the
 * other entries in package.json) — there is no build step to avoid.
 */

import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** A relative specifier — the only kind either rule below applies to. */
export function isRelative(specifier: string): boolean {
  return /^\.\.?\//.test(specifier);
}

function isFile(path: string): boolean {
  // statSync throws on a broken symlink; existsSync already excluded ENOENT,
  // so anything thrown here is a genuinely odd entry and is not a file.
  if (!existsSync(path)) return false;
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * The loader's narrow rule, unchanged in behaviour.
 *
 * tsx normally maps a NodeNext `./module.js` import to module.tsx after trying
 * module.ts. Under heavy parallel startup that fallback has intermittently
 * stopped at the missing .ts candidate. Resolving the unambiguous TSX-only
 * case here means doctest loading does not depend on that downstream
 * extension-probe sequence.
 *
 * Returns the `.tsx` file URL when — and only when — the specifier is a
 * relative `.js`, its `.ts` sibling is absent, and its `.tsx` sibling exists.
 * Any other shape returns null and the caller delegates to the next resolver.
 *
 * @param specifier
 * @param parentURL - the importing module's URL (`file:` only)
 * @returns a `file:` URL, or null
 */
export function tsxOnlyFallback(specifier: string, parentURL: string | undefined): string | null {
  if (!parentURL || !parentURL.startsWith("file:")) return null;
  if (!isRelative(specifier)) return null;
  if (!specifier.endsWith(".js")) return null;

  const stem = specifier.slice(0, -3);
  const tsUrl = new URL(`${stem}.ts`, parentURL);
  const tsxUrl = new URL(`${stem}.tsx`, parentURL);
  if (existsSync(fileURLToPath(tsUrl))) return null;
  if (!existsSync(fileURLToPath(tsxUrl))) return null;
  return tsxUrl.href;
}

/** Context for {@link candidateFiles}. */
export interface CandidateFilesContext {
  /** Absolute directory of the importing module. */
  importerDir: string;
  /**
   * Maps a prefix (e.g. `@shared/`) to an absolute directory. Passed in,
   * never baked in: this package must not learn any consumer's tsconfig.
   */
  aliases: Record<string, string>;
}

/**
 * Every path a specifier could resolve to, most-preferred first, filtered to
 * paths that exist and are files.
 *
 * Broader than {@link tsxOnlyFallback} because a static consumer has no tsx
 * underneath it doing NodeNext resolution — it has to enumerate the candidates
 * itself. The order mirrors what tsx does: exact match, then `.ts`, `.tsx`,
 * `.js`, then directory index files.
 *
 * Returning MORE than one candidate is meaningful and must not be collapsed by
 * the caller: a consumer building a dependency graph should treat every
 * candidate as an edge. Over-approximating costs extra work; picking wrong
 * silently loses an edge.
 *
 * The directory check is load-bearing. `existsSync` alone matches a *directory*
 * named `trpc` for the specifier `./trpc`, and handing that to a bundler
 * produces "Cannot read file: is a directory" — which is the same
 * directory-index shape as the loader's known TSX flake.
 *
 * @param specifier
 * @param context
 * @returns absolute paths
 */
export function candidateFiles(specifier: string, context: CandidateFilesContext): string[] {
  const { importerDir, aliases } = context;

  let base: string | null = null;
  for (const [prefix, dir] of Object.entries(aliases)) {
    if (specifier.startsWith(prefix)) {
      base = join(dir, specifier.slice(prefix.length));
      break;
    }
  }
  if (base === null) {
    if (!isRelative(specifier)) return [];
    base = join(importerDir, specifier);
  }

  const stem = base.endsWith(".js") ? base.slice(0, -3) : base;
  const candidates = [
    ...(base.endsWith(".js") ? [] : [base]),
    `${stem}.ts`,
    `${stem}.tsx`,
    `${stem}.js`,
    join(stem, "index.ts"),
    join(stem, "index.tsx"),
    join(stem, "index.js"),
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (isFile(candidate)) out.push(candidate);
  }
  return out;
}

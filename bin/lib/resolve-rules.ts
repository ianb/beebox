/**
 * Module-resolution rules for the static import-graph builder
 * (bin/test-graph.ts): the candidate files a specifier could resolve to.
 *
 * Ambiguity is meaningful: a graph treats every candidate as an edge, because
 * over-approximating costs a test run while picking wrong silently loses one.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

/** A relative specifier — the only kind {@link candidateFiles} resolves. */
export function isRelative(specifier: string): boolean {
  return /^\.\.?\//.test(specifier);
}

function isFile(path: string): boolean {
  // statSync throws on a broken symlink; existsSync already excluded ENOENT,
  // so anything thrown here is a genuinely odd entry and is not a file.
  if (!existsSync(path)) return false;
  try {
    return statSync(path).isFile();
  } catch (_e) {
    return false;
  }
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
 * A static consumer has no tsx underneath it doing NodeNext resolution, so it
 * has to enumerate the candidates itself. The order mirrors what tsx does:
 * exact match, then `.ts`, `.tsx`, `.js`, then directory index files.
 *
 * Returning MORE than one candidate is meaningful and must not be collapsed by
 * the caller: a consumer building a dependency graph should treat every
 * candidate as an edge. Over-approximating costs extra work; picking wrong
 * silently loses an edge.
 *
 * The directory check matters: `existsSync` alone matches a *directory*
 * named `trpc` for the specifier `./trpc`, and handing that to a bundler
 * produces "Cannot read file: is a directory".
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

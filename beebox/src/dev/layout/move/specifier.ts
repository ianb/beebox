/**
 * Recomputes an import specifier after a move: preserves the original's
 * extension style (`.js` stays `.js`, extensionless stays extensionless) and
 * `./` prefix for a relative specifier, and recomputes within the alias root
 * (or falls back to relative) for an aliased one. Reused by both `.ts` files
 * (AST-located edits, `ts-edit.ts`) and doctest fences (`doctest-edit.ts`).
 */
import * as posixPath from "node:path/posix";
import { baseOf, isWithin } from "../graph.js";
import type { Aliases } from "../scan/resolve.js";

type AliasEntry = Aliases["entries"][number];

const JS_EXTENSIONS = [".js", ".mjs", ".cjs", ".jsx"];
const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const KNOWN_EXTENSIONS = [...JS_EXTENSIONS, ...TS_EXTENSIONS];

/**
 * `dir/file.ts` -> `dir/file`. Strips only the real file extension —
 * unlike `graph.ts`'s `stemOf` (built for the layout check's unit-name
 * grouping), it leaves a `.test.ts`/`.tour.ts` file's `.test`/`.tour`
 * component alone, so a moved `foo.test.ts` imported as `./foo.test.js`
 * still reconstructs to `.../foo.test.js`, not `.../foo.js`.
 */
export function pathWithoutExtension(path: string): string {
  const ext = KNOWN_EXTENSIONS.find((candidate) => path.endsWith(candidate));
  return ext === undefined ? path : path.slice(0, -ext.length);
}

function splitQuery(specifier: string): { base: string; query: string } {
  const mark = specifier.indexOf("?");
  return mark === -1 ? { base: specifier, query: "" } : { base: specifier.slice(0, mark), query: specifier.slice(mark) };
}

/** The trailing extension (plus any bundler query suffix) of `specifier`, or `""` when extensionless. */
function extensionSuffixOf(specifier: string): string {
  const { base, query } = splitQuery(specifier);
  const ext = KNOWN_EXTENSIONS.find((candidate) => base.endsWith(candidate));
  return (ext ?? "") + query;
}

export function computeRelativeSpecifier(params: {
  newImporterDir: string;
  newTargetPath: string;
  oldSpecifier: string;
}): string {
  const withoutExt = pathWithoutExtension(params.newTargetPath);
  let rel = posixPath.relative(params.newImporterDir, withoutExt);
  if (rel === "") rel = baseOf(withoutExt);
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel + extensionSuffixOf(params.oldSpecifier);
}

/**
 * Reconstructs the wildcard alias entry an already-resolved specifier used,
 * well enough to recompute it after a move. Handles this repo's `"@x/*":
 * ["./dir/*"]` shape; a multi-target alias uses the first candidate.
 */
function matchingAliasRoot(params: { oldSpecifier: string; aliases: Aliases }): { entry: AliasEntry; rootDir: string } | null {
  for (const entry of params.aliases.entries) {
    if (!entry.hasWildcard) continue;
    if (!params.oldSpecifier.startsWith(entry.prefix) || !params.oldSpecifier.endsWith(entry.suffix)) continue;
    const target = entry.targets[0];
    if (target === undefined) continue;
    const rootDir = posixPath.normalize(posixPath.join(params.aliases.baseDir, target.replace("*", ""))).replace(/\/$/, "");
    return { entry, rootDir };
  }
  return null;
}

function computeAliasSpecifier(params: {
  oldSpecifier: string;
  newImporterDir: string;
  newTargetPath: string;
  aliases: Aliases;
}): string {
  const match = matchingAliasRoot({ oldSpecifier: params.oldSpecifier, aliases: params.aliases });
  if (match === null || !isWithin(params.newTargetPath, match.rootDir)) {
    return computeRelativeSpecifier({
      newImporterDir: params.newImporterDir,
      newTargetPath: params.newTargetPath,
      oldSpecifier: params.oldSpecifier,
    });
  }
  const withoutExt = pathWithoutExtension(params.newTargetPath);
  const relInRoot = withoutExt.slice(match.rootDir.length + 1);
  return `${match.entry.prefix}${relInRoot}${match.entry.suffix}${extensionSuffixOf(params.oldSpecifier)}`;
}

export function computeNewSpecifier(params: {
  oldSpecifier: string;
  newImporterDir: string;
  newTargetPath: string;
  aliases: Aliases;
}): string {
  if (params.oldSpecifier.startsWith(".")) {
    return computeRelativeSpecifier({
      newImporterDir: params.newImporterDir,
      newTargetPath: params.newTargetPath,
      oldSpecifier: params.oldSpecifier,
    });
  }
  return computeAliasSpecifier(params);
}

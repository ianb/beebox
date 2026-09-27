/**
 * Collects every import edge a move list affects: an edge whose resolved
 * target is a moved file, or any resolved edge inside a file that is itself
 * moved (its own directory may have changed, changing every relative
 * specifier it writes). Scans every default package root plus `bin/**\/*.ts`
 * directly (`roots.ts`), since `bin/` has no package root of its own.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dirOf } from "../graph.js";
import { modules, tests } from "../graph.js";
import type { ImportEdge } from "../model.js";
import { extractModuleFacts, parseSourceFile } from "../scan/imports.js";
import { scanPackage } from "../scan/package/scan.js";
import { type Aliases, loadAliases, resolveImport } from "../scan/resolve.js";
import { binFiles } from "./roots.js";
import { computeNewSpecifier } from "./specifier.js";

export interface EdgeSource {
  /** Importer's path before the move. */
  path: string;
  imports: ImportEdge[];
  aliases: Aliases;
}

const NO_ALIASES: Aliases = { baseDir: "", entries: [] };

function binEdgeSource(params: { repoRoot: string; path: string }): EdgeSource {
  const sourceText = readFileSync(join(params.repoRoot, params.path), "utf8");
  const sourceFile = parseSourceFile({ fileName: params.path, sourceText });
  const facts = extractModuleFacts(sourceFile);
  const imports: ImportEdge[] = facts.imports.map((raw) => {
    const resolved = resolveImport({
      specifier: raw.specifier,
      importerPath: params.path,
      repoRoot: params.repoRoot,
      aliases: NO_ALIASES,
    });
    return {
      specifier: raw.specifier,
      target: resolved.target,
      external: resolved.external,
      typeOnly: raw.typeOnly,
      names: raw.names,
      dynamic: raw.dynamic,
    };
  });
  return { path: params.path, imports, aliases: NO_ALIASES };
}

export async function collectSources(params: { repoRoot: string; roots: string[] }): Promise<EdgeSource[]> {
  const sources: EdgeSource[] = [];
  for (const root of params.roots) {
    const layout = await scanPackage({ repoRoot: params.repoRoot, packageRoot: root });
    const aliases = loadAliases({ repoRoot: params.repoRoot, packageRoot: root });
    for (const file of [...modules(layout), ...tests(layout)]) {
      sources.push({ path: file.path, imports: file.imports, aliases });
    }
  }
  for (const path of binFiles(params.repoRoot)) sources.push(binEdgeSource({ repoRoot: params.repoRoot, path }));
  return sources;
}

export interface CollectedRewrites {
  /** Importer's path AFTER the move (unchanged if it didn't move) -> old specifier -> new specifier. */
  byImporter: Map<string, Map<string, string>>;
  edgeCount: number;
}

export function collectRewrites(params: { sources: EdgeSource[]; moveMap: ReadonlyMap<string, string> }): CollectedRewrites {
  const byImporter = new Map<string, Map<string, string>>();
  let edgeCount = 0;
  for (const source of params.sources) {
    const newImporterPath = params.moveMap.get(source.path) ?? source.path;
    const importerMoved = params.moveMap.has(source.path);
    for (const edge of source.imports) {
      if (edge.target === null) continue;
      const targetMoved = params.moveMap.has(edge.target);
      if (!importerMoved && !targetMoved) continue;
      const newTargetPath = params.moveMap.get(edge.target) ?? edge.target;
      const newSpecifier = computeNewSpecifier({
        oldSpecifier: edge.specifier,
        newImporterDir: dirOf(newImporterPath),
        newTargetPath,
        aliases: source.aliases,
      });
      if (newSpecifier === edge.specifier) continue;
      let rewrites = byImporter.get(newImporterPath);
      if (rewrites === undefined) {
        rewrites = new Map();
        byImporter.set(newImporterPath, rewrites);
      }
      rewrites.set(edge.specifier, newSpecifier);
      edgeCount++;
    }
  }
  return { byImporter, edgeCount };
}

/**
 * Collects every import edge a move list affects: an edge whose resolved
 * target is a moved file, or any resolved edge inside a file that is itself
 * moved (its own directory may have changed, changing every relative
 * specifier it writes). Scans every default package root, `bin/**\/*.ts`,
 * and every other tracked TypeScript/JavaScript file outside both
 * (`roots.ts`'s `otherFiles`) — e.g. `schedules/`, `site/`, `dev/`,
 * `research/`, root config files — resolving each such file's aliases
 * against its nearest ancestor `tsconfig.json`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dirOf } from "../graph.js";
import { modules, tests } from "../graph.js";
import type { ImportEdge } from "../model.js";
import { extractModuleFacts, parseSourceFile } from "../scan/imports.js";
import { scanPackage } from "../scan/package/scan.js";
import { type Aliases, loadAliases, resolveImport } from "../scan/resolve.js";
import { binFiles, otherFiles } from "./roots.js";
import { computeNewSpecifier } from "./specifier.js";

export interface EdgeSource {
  /** Importer's path before the move. */
  path: string;
  imports: ImportEdge[];
  aliases: Aliases;
}

const NO_ALIASES: Aliases = { baseDir: "", entries: [] };

function directEdgeSource(params: { repoRoot: string; path: string; aliases: Aliases }): EdgeSource {
  const sourceText = readFileSync(join(params.repoRoot, params.path), "utf8");
  const sourceFile = parseSourceFile({ fileName: params.path, sourceText });
  const facts = extractModuleFacts(sourceFile);
  const imports: ImportEdge[] = facts.imports.map((raw) => {
    const resolved = resolveImport({
      specifier: raw.specifier,
      importerPath: params.path,
      repoRoot: params.repoRoot,
      aliases: params.aliases,
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
  return { path: params.path, imports, aliases: params.aliases };
}

/** The nearest ancestor directory (possibly the repo root) with its own `tsconfig.json`, for alias resolution. */
function nearestTsconfigDir(params: { repoRoot: string; path: string }): string {
  let dir = dirOf(params.path);
  while (dir !== "") {
    if (existsSync(join(params.repoRoot, dir, "tsconfig.json"))) return dir;
    dir = dirOf(dir);
  }
  return "";
}

function otherEdgeSource(params: { repoRoot: string; path: string }): EdgeSource {
  const packageRoot = nearestTsconfigDir({ repoRoot: params.repoRoot, path: params.path });
  const aliases = loadAliases({ repoRoot: params.repoRoot, packageRoot });
  return directEdgeSource({ repoRoot: params.repoRoot, path: params.path, aliases });
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
  const bin = binFiles(params.repoRoot);
  for (const path of bin) sources.push(directEdgeSource({ repoRoot: params.repoRoot, path, aliases: NO_ALIASES }));
  for (const path of otherFiles({ repoRoot: params.repoRoot, roots: params.roots, binFiles: bin })) {
    sources.push(otherEdgeSource({ repoRoot: params.repoRoot, path }));
  }
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

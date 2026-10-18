/**
 * Scanner entry point: builds a `PackageLayout` from disk for one package
 * root. See the sibling modules for each job: `files.ts` (listing and
 * classification), `imports.ts` (AST import extraction), `resolve.ts`
 * (specifier resolution), `registries.ts` (`defineRegistry` extraction),
 * `surfaces.ts` (public surfaces).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isWithin } from "../../graph.js";
import type { Finding, ImportEdge, LayoutFile, ModuleFile, PackageLayout, TestFile } from "../../model.js";
import { classifyFile, listPackageFiles } from "./files.js";
import { extractModuleFacts, parseSourceFile, type RawImportEdge } from "../imports.js";
import { extractRegistries } from "./registries.js";
import { type Aliases, loadAliases, resolveImport } from "../resolve.js";
import { buildEntriesFromFiles, buildEntriesOf, scanEnclosingSurfaces, scanPublicSurfaces } from "./surfaces.js";

function resolveEdges(params: {
  rawEdges: RawImportEdge[];
  importerPath: string;
  repoRoot: string;
  aliases: Aliases;
}): { edges: ImportEdge[]; findings: Finding[] } {
  const edges: ImportEdge[] = [];
  const findings: Finding[] = [];
  for (const raw of params.rawEdges) {
    const resolved = resolveImport({
      specifier: raw.specifier,
      importerPath: params.importerPath,
      repoRoot: params.repoRoot,
      aliases: params.aliases,
    });
    edges.push({
      specifier: raw.specifier,
      target: resolved.target,
      external: resolved.external,
      typeOnly: raw.typeOnly,
      names: raw.names,
      dynamic: raw.dynamic,
    });
    if (resolved.target === null && !resolved.external) {
      findings.push({ rule: "scan", path: params.importerPath, message: `unresolved import ${raw.specifier}` });
    }
  }
  return { edges, findings };
}

function buildModuleFile(params: {
  path: string;
  repoRoot: string;
  aliases: Aliases;
  findings: Finding[];
}): ModuleFile {
  const sourceText = readFileSync(join(params.repoRoot, params.path), "utf8");
  const sourceFile = parseSourceFile({ fileName: params.path, sourceText });
  const facts = extractModuleFacts(sourceFile);
  const resolved = resolveEdges({
    rawEdges: facts.imports,
    importerPath: params.path,
    repoRoot: params.repoRoot,
    aliases: params.aliases,
  });
  params.findings.push(...resolved.findings);
  const registryResult = extractRegistries({ sourceFile, filePath: params.path, imports: resolved.edges });
  params.findings.push(...registryResult.findings);
  return {
    kind: "module",
    path: params.path,
    imports: resolved.edges,
    registries: registryResult.registries,
    reexportOnly: facts.reexportOnly,
    topLevelCalls: facts.topLevelCalls,
    relativePathLiterals: facts.relativePathLiterals,
    buildEntries: buildEntriesOf(sourceFile),
  };
}

function importsFromSource(params: {
  path: string;
  sourceText: string;
  fileName: string;
  repoRoot: string;
  aliases: Aliases;
  findings: Finding[];
}): ImportEdge[] {
  const sourceFile = parseSourceFile({ fileName: params.fileName, sourceText: params.sourceText });
  const facts = extractModuleFacts(sourceFile);
  const resolved = resolveEdges({
    rawEdges: facts.imports,
    importerPath: params.path,
    repoRoot: params.repoRoot,
    aliases: params.aliases,
  });
  params.findings.push(...resolved.findings);
  return resolved.edges;
}

function buildTestFile(params: {
  path: string;
  repoRoot: string;
  aliases: Aliases;
  findings: Finding[];
}): TestFile {
  const sourceText = readFileSync(join(params.repoRoot, params.path), "utf8");
  const imports = importsFromSource({
    path: params.path,
    sourceText,
    fileName: params.path,
    repoRoot: params.repoRoot,
    aliases: params.aliases,
    findings: params.findings,
  });
  return { kind: "test", path: params.path, imports };
}

function compareFindings(a: Finding, b: Finding): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.message !== b.message) return a.message < b.message ? -1 : 1;
  return 0;
}

export async function scanPackage(params: { repoRoot: string; packageRoot: string }): Promise<PackageLayout> {
  const listed = await listPackageFiles(params);
  const aliases = loadAliases(params);
  const files = new Map<string, LayoutFile>();
  const scanFindings: Finding[] = [];
  const sourceRoots = [`${params.packageRoot}/src`, ...listed.extraSourceRoots];

  for (const path of listed.files) {
    const isSourceRoot = sourceRoots.some((root) => isWithin(path, root));
    const kind = classifyFile(path, isSourceRoot);
    if (kind === "declaration" || kind === "data") {
      files.set(path, { kind, path });
    } else if (kind === "test") {
      files.set(path, buildTestFile({ path, repoRoot: params.repoRoot, aliases, findings: scanFindings }));
    } else {
      files.set(path, buildModuleFile({ path, repoRoot: params.repoRoot, aliases, findings: scanFindings }));
    }
  }

  const buildEntries = buildEntriesFromFiles(files);
  return {
    root: params.packageRoot,
    sourceRoot: `${params.packageRoot}/src`,
    testRoot: `${params.packageRoot}/test`,
    extraSourceRoots: listed.extraSourceRoots,
    nestedPackages: listed.nestedPackages,
    files,
    directories: listed.directories,
    publicSurfaces: scanPublicSurfaces({ ...params, buildEntries }),
    enclosingSurfaces: scanEnclosingSurfaces(params),
    scanFindings: scanFindings.toSorted(compareFindings),
  };
}

/**
 * Scanner entry point: builds a `PackageLayout` from disk for one package
 * root. See the sibling modules for each job: `files.ts` (listing and
 * classification), `imports.ts` (AST import extraction), `resolve.ts`
 * (specifier resolution), `registries.ts` (`defineRegistry` extraction),
 * `surfaces.ts` (public surfaces).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { errorMessage } from "../../../../lib/error-guards.js";
import { isRecord } from "../../../../lib/is-record.js";
import { invariant } from "../../../../lib/invariant.js";
import { isWithin } from "../../graph.js";
import type { Finding, ImportEdge, LayoutFile, ModuleFile, PackageLayout, TestFile } from "../../model.js";
import { classifyFile, listPackageFiles } from "./files.js";
import { extractModuleFacts, parseSourceFile, type RawImportEdge } from "../imports.js";
import { extractRegistries } from "./registries.js";
import { type Aliases, loadAliases, resolveImport } from "../resolve.js";
import { scanEnclosingSurfaces, scanPublicSurfaces } from "./surfaces.js";

// Loaded via a dynamic import behind a non-literal specifier, not a static
// `import ... from "agent-doctest/hooks"`: that file's own relative imports
// use real `.ts` extensions (it is Node's ESM loader hook, resolved outside
// tsx's extension-probing — see its header comment), which only typechecks
// under `allowImportingTsExtensions`. Our tsconfig doesn't set that, and a
// static import would pull doctest-hooks.ts into this program and fail with
// TS5097. `bin/test-graph.ts` resolves the same package the same way.
interface DoctestHooks {
  generateTestSource: (markdown: string, path: string) => string;
}

function hasGenerateTestSource(module: unknown): module is DoctestHooks {
  return isRecord(module) && typeof module["generateTestSource"] === "function";
}

let doctestHooksPromise: Promise<DoctestHooks> | null = null;

function loadDoctestHooks(): Promise<DoctestHooks> {
  if (doctestHooksPromise === null) {
    const specifier: string = "agent-doctest/hooks";
    doctestHooksPromise = import(specifier).then((module: unknown) => {
      invariant(hasGenerateTestSource(module), "agent-doctest/hooks has no generateTestSource export");
      return module;
    });
  }
  return doctestHooksPromise;
}

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

async function buildDoctestFile(params: {
  path: string;
  repoRoot: string;
  aliases: Aliases;
  findings: Finding[];
}): Promise<TestFile> {
  const markdown = readFileSync(join(params.repoRoot, params.path), "utf8");
  let generated: string;
  try {
    const hooks = await loadDoctestHooks();
    generated = hooks.generateTestSource(markdown, params.path);
  } catch (error) {
    params.findings.push({
      rule: "scan",
      path: params.path,
      message: `doctest failed to generate: ${errorMessage(error)}`,
    });
    return { kind: "test", path: params.path, imports: [] };
  }
  const imports = importsFromSource({
    path: params.path,
    sourceText: generated,
    fileName: `${params.path}.ts`,
    repoRoot: params.repoRoot,
    aliases: params.aliases,
    findings: params.findings,
  });
  return { kind: "test", path: params.path, imports };
}

async function buildTestFile(params: {
  path: string;
  repoRoot: string;
  aliases: Aliases;
  findings: Finding[];
}): Promise<TestFile> {
  if (params.path.endsWith(".doctest.md")) return buildDoctestFile(params);
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
      files.set(path, await buildTestFile({ path, repoRoot: params.repoRoot, aliases, findings: scanFindings }));
    } else {
      files.set(path, buildModuleFile({ path, repoRoot: params.repoRoot, aliases, findings: scanFindings }));
    }
  }

  return {
    root: params.packageRoot,
    sourceRoot: `${params.packageRoot}/src`,
    testRoot: `${params.packageRoot}/test`,
    extraSourceRoots: listed.extraSourceRoots,
    nestedPackages: listed.nestedPackages,
    files,
    directories: listed.directories,
    publicSurfaces: scanPublicSurfaces(params),
    enclosingSurfaces: scanEnclosingSurfaces(params),
    scanFindings: scanFindings.toSorted(compareFindings),
  };
}

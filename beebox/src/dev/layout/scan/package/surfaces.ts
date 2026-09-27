/**
 * Public surfaces: `package.json` `exports` mapped to the build entry (or
 * source file) that produces each target. A build entry is any module in the
 * package (or an enclosing package, walked the same way `scanEnclosingSurfaces`
 * always has) that calls esbuild's `build({ entryPoints: [...], outfile: ... })`
 * with a literal path. `ModuleFile.buildEntries` (`scan.ts`) extracts this fact
 * once, during the module's normal parse, so scanning the current package's
 * own surfaces reuses `PackageLayout.files` rather than re-walking the disk;
 * an enclosing package has no such `PackageLayout` already in hand, so
 * `collectBuildEntries` below gives it its own lightweight walk — a plain
 * recursive directory listing (no git, so it works the same whether or not
 * the enclosing package sits in the same repo checkout the caller does),
 * parsing each candidate module once with the same `parseSourceFile` the
 * main scan uses.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import type { LayoutFile, PublicSurface } from "../../model.js";
import { isRecord } from "../../../../shared/is-record.js";
import { dirOf } from "../../graph.js";
import { parseSourceFile } from "../imports.js";
import { isRepoFile, resolveRepoRelative } from "../resolve.js";

function literalPathFromJoinOrString(expression: ts.Expression): string | null {
  if (ts.isStringLiteral(expression)) return expression.text;
  if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression)) return null;
  if (expression.expression.text !== "join" || expression.arguments.length < 2) return null;
  const segments: string[] = [];
  for (const arg of expression.arguments.slice(1)) {
    if (!ts.isStringLiteral(arg)) return null;
    segments.push(arg.text);
  }
  return segments.length > 0 ? segments.join("/") : null;
}

function unwrapParens(expression: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expression) ? unwrapParens(expression.expression) : expression;
}

function propertyOf(object: ts.ObjectLiteralExpression, name: string): ts.Expression | null {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name) {
      return property.initializer;
    }
  }
  return null;
}

function findBuildCalls(sourceFile: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "build") {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

function entryOutfileFromCall(call: ts.CallExpression): { entry: string; outfile: string } | null {
  const firstArg = call.arguments[0];
  if (firstArg === undefined) return null;
  const object = unwrapParens(firstArg);
  if (!ts.isObjectLiteralExpression(object)) return null;

  const entryPointsExpr = propertyOf(object, "entryPoints");
  const outfileExpr = propertyOf(object, "outfile");
  if (entryPointsExpr === null || outfileExpr === null || !ts.isArrayLiteralExpression(entryPointsExpr)) return null;
  const firstEntryPoint = entryPointsExpr.elements[0];
  if (firstEntryPoint === undefined) return null;

  const entry = literalPathFromJoinOrString(firstEntryPoint);
  const outfile = literalPathFromJoinOrString(outfileExpr);
  return entry === null || outfile === null ? null : { entry, outfile };
}

/** Every esbuild `build({...})` call in `sourceFile` with literal `entryPoints`/`outfile`. */
export function buildEntriesOf(sourceFile: ts.SourceFile): Array<{ entry: string; outfile: string }> {
  const out: Array<{ entry: string; outfile: string }> = [];
  for (const call of findBuildCalls(sourceFile)) {
    const found = entryOutfileFromCall(call);
    if (found !== null) out.push(found);
  }
  return out;
}

/** outfile (relative to `<pkg>/dist`) -> entry (relative to the package root), aggregated across a package's already-scanned modules. */
export function buildEntriesFromFiles(files: ReadonlyMap<string, LayoutFile>): Map<string, string> {
  const entries = new Map<string, string>();
  for (const file of files.values()) {
    if (file.kind !== "module") continue;
    for (const { entry, outfile } of file.buildEntries) {
      if (!entries.has(outfile)) entries.set(outfile, entry);
    }
  }
  return entries;
}

const EXCLUDED_DIR_NAMES = new Set(["node_modules", "dist", "test"]);

/** TypeScript module files under `packageRoot`, nested packages and dot-dirs excluded. */
function listCandidateModules(params: { repoRoot: string; packageRoot: string }): string[] {
  const out: string[] = [];
  const walk = (relDir: string): void => {
    const absDir = join(params.repoRoot, relDir);
    if (!existsSync(absDir)) return;
    for (const dirent of readdirSync(absDir, { withFileTypes: true })) {
      const relPath = relDir === "" ? dirent.name : `${relDir}/${dirent.name}`;
      if (dirent.isDirectory()) {
        if (dirent.name.startsWith(".") || EXCLUDED_DIR_NAMES.has(dirent.name)) continue;
        // A directory with its own `package.json` is a nested package (except
        // `packageRoot` itself); its files belong to that package's own scan.
        if (relPath !== params.packageRoot && existsSync(join(params.repoRoot, relPath, "package.json"))) continue;
        walk(relPath);
      } else if (dirent.isFile() && /\.tsx?$/u.test(dirent.name) && !dirent.name.endsWith(".d.ts")) {
        out.push(relPath);
      }
    }
  };
  walk(params.packageRoot);
  return out;
}

/**
 * The same aggregation as `buildEntriesFromFiles`, for a package that has no
 * `PackageLayout` already in hand (an enclosing package `scanEnclosingSurfaces`
 * is walking up to): list its candidate modules once, parse each once with
 * the same `parseSourceFile` the main scan uses.
 */
function collectBuildEntries(params: { repoRoot: string; packageRoot: string }): Map<string, string> {
  const entries = new Map<string, string>();
  for (const path of listCandidateModules(params)) {
    const sourceText = readFileSync(join(params.repoRoot, path), "utf8");
    const sourceFile = parseSourceFile({ fileName: path, sourceText });
    for (const { entry, outfile } of buildEntriesOf(sourceFile)) {
      if (!entries.has(outfile)) entries.set(outfile, entry);
    }
  }
  return entries;
}

function chooseExportTarget(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return null;
  const preferred = value["default"];
  if (typeof preferred === "string") return preferred;
  const importCondition = value["import"];
  if (typeof importCondition === "string") return importCondition;
  for (const candidate of Object.values(value)) {
    if (typeof candidate === "string") return candidate;
  }
  return null;
}

function sourceFor(params: {
  target: string;
  packageRoot: string;
  repoRoot: string;
  buildEntries: Map<string, string>;
}): string | null {
  const distPrefix = `${params.packageRoot}/dist/`;
  if (params.target.startsWith(distPrefix) && params.target.endsWith(".js")) {
    const distSuffix = params.target.slice(distPrefix.length);
    const entry = params.buildEntries.get(distSuffix);
    if (entry !== undefined) return resolveRepoRelative({ fromDir: params.packageRoot, relative: entry });
    const stem = distSuffix.slice(0, -".js".length);
    for (const ext of [".ts", ".tsx"]) {
      const candidate = resolveRepoRelative({ fromDir: params.packageRoot, relative: `src/${stem}${ext}` });
      if (isRepoFile(join(params.repoRoot, candidate))) return candidate;
    }
    return null;
  }
  return params.target.endsWith(".js") ? null : params.target;
}

export function scanPublicSurfaces(params: {
  repoRoot: string;
  packageRoot: string;
  buildEntries: Map<string, string>;
}): PublicSurface[] {
  const packageJsonPath = join(params.repoRoot, params.packageRoot, "package.json");
  if (!existsSync(packageJsonPath)) return [];
  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const exportsRaw = isRecord(parsed) ? parsed["exports"] : undefined;
  if (!isRecord(exportsRaw)) return [];

  const surfaces: PublicSurface[] = [];
  for (const [specifier, value] of Object.entries(exportsRaw)) {
    const chosen = chooseExportTarget(value);
    if (chosen === null) continue;
    const target = resolveRepoRelative({ fromDir: params.packageRoot, relative: chosen });
    const source = sourceFor({
      target,
      packageRoot: params.packageRoot,
      repoRoot: params.repoRoot,
      buildEntries: params.buildEntries,
    });
    surfaces.push({ specifier, target, source });
  }
  return surfaces;
}

/**
 * Every ancestor directory of `packageRoot`, from its parent up through the
 * repo root (`""`), that itself directly contains a `package.json` — the
 * chain of enclosing packages a nested package (`beebox/src/frontend`)
 * sits under (`beebox`, then the repo root).
 */
function ancestorPackageRoots(params: { repoRoot: string; packageRoot: string }): string[] {
  const roots: string[] = [];
  let dir = dirOf(params.packageRoot);
  for (;;) {
    if (isRepoFile(join(params.repoRoot, dir, "package.json"))) roots.push(dir);
    if (dir === "") break;
    dir = dirOf(dir);
  }
  return roots;
}

/**
 * Public surfaces declared by every package enclosing `packageRoot`, read
 * the same way as `scanPublicSurfaces`. A nested package's own module can be
 * the source an enclosing package's `package.json` `exports` builds from
 * (`beebox`'s `./view-widgets`, built from a file in
 * `beebox/src/frontend/src/exports/`).
 */
export function scanEnclosingSurfaces(params: { repoRoot: string; packageRoot: string }): PublicSurface[] {
  return ancestorPackageRoots(params).flatMap((packageRoot) => {
    const buildEntries = collectBuildEntries({ repoRoot: params.repoRoot, packageRoot });
    return scanPublicSurfaces({ repoRoot: params.repoRoot, packageRoot, buildEntries });
  });
}

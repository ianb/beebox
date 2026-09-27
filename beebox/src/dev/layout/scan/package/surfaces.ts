/**
 * Public surfaces: `package.json` `exports` mapped to the build entry (or
 * source file) that produces each target, read from `<pkg>/scripts/*.ts`'s
 * esbuild `build({...})` calls.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import type { PublicSurface } from "../../model.js";
import { isRecord } from "../../../../lib/is-record.js";
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

/** outfile (relative to `<pkg>/dist`) -> entry (relative to the package root). */
function loadBuildEntries(params: { repoRoot: string; packageRoot: string }): Map<string, string> {
  const scriptsDir = join(params.repoRoot, params.packageRoot, "scripts");
  const entries = new Map<string, string>();
  if (!existsSync(scriptsDir)) return entries;
  for (const dirent of readdirSync(scriptsDir, { withFileTypes: true })) {
    if (!dirent.isFile() || !dirent.name.endsWith(".ts")) continue;
    const filePath = join(scriptsDir, dirent.name);
    const sourceFile = ts.createSourceFile(filePath, readFileSync(filePath, "utf8"), ts.ScriptTarget.Latest, true);
    for (const call of findBuildCalls(sourceFile)) {
      const found = entryOutfileFromCall(call);
      if (found !== null && !entries.has(found.outfile)) entries.set(found.outfile, found.entry);
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

export function scanPublicSurfaces(params: { repoRoot: string; packageRoot: string }): PublicSurface[] {
  const packageJsonPath = join(params.repoRoot, params.packageRoot, "package.json");
  if (!existsSync(packageJsonPath)) return [];
  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const exportsRaw = isRecord(parsed) ? parsed["exports"] : undefined;
  if (!isRecord(exportsRaw)) return [];

  const buildEntries = loadBuildEntries(params);
  const surfaces: PublicSurface[] = [];
  for (const [specifier, value] of Object.entries(exportsRaw)) {
    const chosen = chooseExportTarget(value);
    if (chosen === null) continue;
    const target = resolveRepoRelative({ fromDir: params.packageRoot, relative: chosen });
    const source = sourceFor({ target, packageRoot: params.packageRoot, repoRoot: params.repoRoot, buildEntries });
    surfaces.push({ specifier, target, source });
  }
  return surfaces;
}

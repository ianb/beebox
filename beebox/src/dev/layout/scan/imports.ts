/**
 * AST import extraction: turns a parsed `ts.SourceFile` into the raw import
 * edges and the other per-module facts the model records. Specifier
 * resolution (turning `specifier` into `target`/`external`) is `resolve.ts`.
 */
import ts from "typescript";

/** An import edge before resolution: `target`/`external` are filled in by `resolve.ts`. */
export interface RawImportEdge {
  specifier: string;
  typeOnly: boolean;
  names: string[];
  dynamic: boolean;
}

export interface ParsedModuleFacts {
  imports: RawImportEdge[];
  reexportOnly: boolean;
  topLevelCalls: string[];
  relativePathLiterals: string[];
}

function scriptKindFor(fileName: string): ts.ScriptKind {
  return fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

export function parseSourceFile(params: { fileName: string; sourceText: string }): ts.SourceFile {
  return ts.createSourceFile(
    params.fileName,
    params.sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(params.fileName),
  );
}

function namesOfImportClause(importClause: ts.ImportClause | undefined): string[] {
  if (importClause === undefined) return [];
  const names: string[] = [];
  if (importClause.name !== undefined) names.push(importClause.name.text);
  const bindings = importClause.namedBindings;
  if (bindings !== undefined) {
    if (ts.isNamespaceImport(bindings)) names.push(bindings.name.text);
    else for (const element of bindings.elements) names.push(element.name.text);
  }
  return names;
}

function isTypeOnlyImport(importClause: ts.ImportClause | undefined): boolean {
  if (importClause === undefined) return false;
  if (importClause.isTypeOnly) return true;
  const bindings = importClause.namedBindings;
  if (importClause.name !== undefined || bindings === undefined || !ts.isNamedImports(bindings)) return false;
  return bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function dynamicImportOrRequireEdge(node: ts.CallExpression): RawImportEdge | null {
  const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
  if (!isDynamicImport && !isRequire) return null;
  const arg = node.arguments[0];
  if (arg === undefined) return null;
  const specifier = literalText(arg);
  if (specifier === null) return null;
  return { specifier, typeOnly: false, names: [], dynamic: isDynamicImport };
}

interface Collected {
  imports: RawImportEdge[];
  relativePathLiterals: string[];
  claimed: Set<ts.Node>;
}

function collectImportDeclaration(node: ts.ImportDeclaration, out: Collected): void {
  const specifier = literalText(node.moduleSpecifier);
  if (specifier === null) return;
  out.claimed.add(node.moduleSpecifier);
  out.imports.push({
    specifier,
    typeOnly: isTypeOnlyImport(node.importClause),
    names: namesOfImportClause(node.importClause),
    dynamic: false,
  });
}

function collectExportDeclaration(node: ts.ExportDeclaration, out: Collected): void {
  if (node.moduleSpecifier === undefined) return;
  const specifier = literalText(node.moduleSpecifier);
  if (specifier === null) return;
  out.claimed.add(node.moduleSpecifier);
  out.imports.push({ specifier, typeOnly: node.isTypeOnly, names: [], dynamic: false });
}

function collectCallExpression(node: ts.CallExpression, out: Collected): void {
  const edge = dynamicImportOrRequireEdge(node);
  if (edge === null) return;
  const arg = node.arguments[0];
  if (arg !== undefined) out.claimed.add(arg);
  out.imports.push(edge);
}

function walk(node: ts.Node, out: Collected): void {
  if (ts.isImportDeclaration(node)) collectImportDeclaration(node, out);
  else if (ts.isExportDeclaration(node)) collectExportDeclaration(node, out);
  else if (ts.isCallExpression(node)) collectCallExpression(node, out);
  else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !out.claimed.has(node)) {
    const text = node.text;
    if (text.startsWith("./") || text.startsWith("../")) out.relativePathLiterals.push(text);
  }
  ts.forEachChild(node, (child) => walk(child, out));
}

function calleeText(expression: ts.Expression, sourceFile: ts.SourceFile): string {
  return expression.getText(sourceFile);
}

function topLevelCallsOf(sourceFile: ts.SourceFile): string[] {
  const calls: string[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement)) continue;
    const expr = ts.isAwaitExpression(statement.expression) ? statement.expression.expression : statement.expression;
    if (ts.isCallExpression(expr)) calls.push(calleeText(expr.expression, sourceFile));
  }
  return calls;
}

function reexportOnlyOf(sourceFile: ts.SourceFile): boolean {
  const statements = sourceFile.statements;
  if (statements.length === 0) return false;
  const allImportOrExport = statements.every((s) => ts.isImportDeclaration(s) || ts.isExportDeclaration(s));
  return allImportOrExport && statements.some((s) => ts.isExportDeclaration(s));
}

export function extractModuleFacts(sourceFile: ts.SourceFile): ParsedModuleFacts {
  const collected: Collected = { imports: [], relativePathLiterals: [], claimed: new Set() };
  walk(sourceFile, collected);
  return {
    imports: collected.imports,
    reexportOnly: reexportOnlyOf(sourceFile),
    topLevelCalls: topLevelCallsOf(sourceFile),
    relativePathLiterals: collected.relativePathLiterals,
  };
}

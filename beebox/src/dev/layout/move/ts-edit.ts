/**
 * Rewrites import/export/dynamic-import/require specifiers in a `.ts`
 * source's text, located by AST position rather than arbitrary string
 * matching, so only real specifier literals are touched.
 */
import ts from "typescript";
import { parseSourceFile } from "../scan/imports.js";

export interface SpecifierLiteral {
  start: number;
  end: number;
  text: string;
}

function literalTextOf(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

export function specifierLiteralsOf(sourceFile: ts.SourceFile): SpecifierLiteral[] {
  const literals: SpecifierLiteral[] = [];
  function record(node: ts.Node): void {
    literals.push({ start: node.getStart(sourceFile), end: node.getEnd(), text: literalTextOf(node) ?? "" });
  }
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && literalTextOf(node.moduleSpecifier) !== null) {
      record(node.moduleSpecifier);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      literalTextOf(node.moduleSpecifier) !== null
    ) {
      record(node.moduleSpecifier);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const arg = node.arguments[0];
      if ((isDynamicImport || isRequire) && arg !== undefined && literalTextOf(arg) !== null) record(arg);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return literals;
}

/** Replaces every specifier literal whose text is a key of `rewrites`, keeping the original quote character. */
export function rewriteTsFile(params: { path: string; text: string; rewrites: ReadonlyMap<string, string> }): string {
  const sourceFile = parseSourceFile({ fileName: params.path, sourceText: params.text });
  const matches = specifierLiteralsOf(sourceFile)
    .filter((literal) => params.rewrites.has(literal.text))
    .toSorted((a, b) => b.start - a.start); // back to front so earlier offsets stay valid
  let text = params.text;
  for (const literal of matches) {
    const newSpecifier = params.rewrites.get(literal.text);
    if (newSpecifier === undefined) continue;
    const quote = text[literal.start] ?? '"';
    text = text.slice(0, literal.start) + quote + newSpecifier + quote + text.slice(literal.end);
  }
  return text;
}

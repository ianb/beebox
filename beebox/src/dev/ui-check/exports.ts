/**
 * Reads what a `components/ui/` module exports and which names a module
 * imports, from a parsed source file.
 */
import * as ts from "../../lib/typescript/syntax.js";

/** PascalCase with at least one lowercase letter (`ALL_CAPS` constants are not components). */
const COMPONENT_NAME = /^[A-Z][\dA-Za-z]*[a-z][\dA-Za-z]*$/;
const HOOK_NAME = /^use[A-Z][\dA-Za-z]*$/;

/** Whether `name` is one the docs must cover: a component (PascalCase) or a `use*` hook. */
export function isDocumentedKind(name: string): boolean {
  return COMPONENT_NAME.test(name) || HOOK_NAME.test(name);
}

function hasExportModifier(node: ts.FunctionDeclaration | ts.ClassDeclaration | ts.VariableStatement): boolean {
  return (node.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * Names this module exports as values: `export function X`, `export const X`,
 * `export class X`, `export { X }`, `export { X as Y }` and
 * `export { X } from "./y"` (by the exported name, so a barrel file counts),
 * and `export default X` of a local (named X). Types are skipped. An anonymous
 * default export has no name to document and throws.
 */
export function exportedValueNames(sourceFile: ts.SourceFile): string[] {
  const names: string[] = [];
  for (const statement of sourceFile.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && hasExportModifier(statement)) {
      if (statement.name !== undefined) names.push(statement.name.text);
      else if (hasDefaultModifier(statement)) throw anonymousDefault(sourceFile);
    } else if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
      }
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const clause = statement.exportClause;
      if (clause !== undefined && ts.isNamedExports(clause)) {
        for (const element of clause.elements) if (!element.isTypeOnly) names.push(element.name.text);
      }
    } else if (ts.isExportAssignment(statement) && statement.isExportEquals !== true) {
      if (!ts.isIdentifier(statement.expression)) throw anonymousDefault(sourceFile);
      names.push(statement.expression.text);
    }
  }
  return names;
}

function hasDefaultModifier(node: ts.FunctionDeclaration | ts.ClassDeclaration): boolean {
  return (node.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
}

class AnonymousDefaultExportError extends Error {
  readonly fileName: string;
  constructor(fileName: string) {
    super("anonymous default export; name it (const X = ...; export default X) so ui-check can read it");
    this.name = "AnonymousDefaultExportError";
    this.fileName = fileName;
  }
}

function anonymousDefault(sourceFile: ts.SourceFile): Error {
  return new AnonymousDefaultExportError(sourceFile.fileName);
}

/** Namespace-use marker: the namespace is used other than as `ns.Name`, so any export may be reached. */
export const ALL_EXPORTS = "*";

/**
 * Imported value names of the module, by the name the exporter declares. A
 * namespace import (`import * as ns`) yields each static `ns.Name` /
 * `ns["Name"]` access, and `*` when `ns` is used any other way.
 */
export function importedNames(sourceFile: ts.SourceFile): { specifier: string; name: string }[] {
  const imported: { specifier: string; name: string }[] = [];
  const namespaces = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
    if (ts.isNamespaceImport(bindings)) namespaces.set(bindings.name.text, specifier);
    else if (ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly) imported.push({ specifier, name: (element.propertyName ?? element.name).text });
      }
    }
  }
  if (namespaces.size > 0) imported.push(...namespaceUses(sourceFile, namespaces));
  return imported;
}

function namespaceUses(sourceFile: ts.SourceFile, namespaces: ReadonlyMap<string, string>): { specifier: string; name: string }[] {
  const uses: { specifier: string; name: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node)) {
      const specifier = namespaces.get(node.text);
      const parent = node.parent;
      if (specifier === undefined) {
        // not a namespace reference
      } else if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        uses.push({ specifier, name: parent.name.text });
      } else if (ts.isElementAccessExpression(parent) && parent.expression === node) {
        const argument = parent.argumentExpression;
        uses.push({ specifier, name: ts.isStringLiteral(argument) ? argument.text : ALL_EXPORTS });
      } else if (!(ts.isPropertyAccessExpression(parent) && parent.name === node)) {
        uses.push({ specifier, name: ALL_EXPORTS });
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return uses;
}

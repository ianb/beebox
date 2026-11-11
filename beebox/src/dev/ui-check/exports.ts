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
 * Names this module declares and exports as values: `export function X`,
 * `export const X`, `export class X`, and `export { X }` of a local. Types and
 * `export { X } from "./y"` re-exports are skipped; the declaring module
 * counts.
 */
export function exportedValueNames(sourceFile: ts.SourceFile): string[] {
  const names: string[] = [];
  for (const statement of sourceFile.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && hasExportModifier(statement)) {
      if (statement.name !== undefined) names.push(statement.name.text);
    } else if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
      }
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier === undefined && !statement.isTypeOnly) {
      const clause = statement.exportClause;
      if (clause !== undefined && ts.isNamedExports(clause)) {
        for (const element of clause.elements) if (!element.isTypeOnly) names.push(element.name.text);
      }
    }
  }
  return names;
}

/** Imported binding names of the module's value imports, by the name the exporter declares. */
export function importedNames(sourceFile: ts.SourceFile): { specifier: string; name: string }[] {
  const imported: { specifier: string; name: string }[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      imported.push({ specifier: statement.moduleSpecifier.text, name: (element.propertyName ?? element.name).text });
    }
  }
  return imported;
}

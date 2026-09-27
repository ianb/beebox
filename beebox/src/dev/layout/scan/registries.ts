/**
 * `defineRegistry` call extraction: reads the declaration a set directory is
 * enumerated by (rule 4 of the layout plan) out of a module's parsed AST.
 */
import ts from "typescript";
import type { Finding, ImportEdge, RegistryDecl, RegistryMember } from "../model.js";
import { resolveRepoRelative } from "./resolve.js";

/** Local identifiers bound to the registry module's `defineRegistry` export. */
interface RegistryBindings {
  /** Names a plain call recognizes: `import { defineRegistry as reg }` binds `reg`. */
  localNames: Set<string>;
  /** Names a `<namespace>.defineRegistry(...)` call recognizes. */
  namespaceNames: Set<string>;
}

function isRegistryModuleTarget(target: string): boolean {
  return /(^|\/)src\/lib\/registry\.ts$/.test(target);
}

function isRegistryModuleSpecifier(specifier: string): boolean {
  return /(^|\/)lib\/registry(\.js)?$/.test(specifier);
}

function targetOfSpecifier(imports: ImportEdge[], specifier: string): string | null {
  const edge = imports.find((candidate) => candidate.specifier === specifier);
  return edge === undefined ? null : edge.target;
}

/**
 * Finds every import of the package's `src/lib/registry.ts` (by resolved
 * target, falling back to the specifier text when unresolved) and collects
 * the local names a call could be written through: a named or renamed
 * `defineRegistry` binding, and a namespace binding for `ns.defineRegistry(...)`.
 * A same-named function imported from anywhere else does not qualify.
 */
function registryBindingsOf(params: { sourceFile: ts.SourceFile; imports: ImportEdge[] }): RegistryBindings {
  const localNames = new Set<string>();
  const namespaceNames = new Set<string>();
  for (const statement of params.sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const target = targetOfSpecifier(params.imports, specifier);
    const isRegistryModule = target !== null ? isRegistryModuleTarget(target) : isRegistryModuleSpecifier(specifier);
    if (!isRegistryModule) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaceNames.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      const importedName = element.propertyName === undefined ? element.name.text : element.propertyName.text;
      if (importedName === "defineRegistry") localNames.add(element.name.text);
    }
  }
  return { localNames, namespaceNames };
}

function isDefineRegistryCall(node: ts.Node, bindings: RegistryBindings): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return bindings.localNames.has(callee.text);
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.name.text === "defineRegistry") {
    return bindings.namespaceNames.has(callee.expression.text);
  }
  return false;
}

function unwrapArgument(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) current = current.expression;
    else if (ts.isSatisfiesExpression(current)) current = current.expression;
    else if (ts.isAsExpression(current)) current = current.expression;
    else return current;
  }
}

function findCalls(sourceFile: ts.SourceFile, bindings: RegistryBindings): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (isDefineRegistryCall(node, bindings)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

function propertyOf(object: ts.ObjectLiteralExpression, name: string): ts.Expression | null {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const propertyName = property.name;
    const text = ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName) ? propertyName.text : null;
    if (text === name) return property.initializer;
  }
  return null;
}

function importSourcesOf(imports: ImportEdge[]): Map<string, string | null> {
  const sources = new Map<string, string | null>();
  for (const edge of imports) {
    for (const name of edge.names) if (!sources.has(name)) sources.set(name, edge.target);
  }
  return sources;
}

function memberOf(params: {
  element: ts.Expression;
  sourceFile: ts.SourceFile;
  importSources: Map<string, string | null>;
  key: string | null;
}): RegistryMember {
  const expression = params.element.getText(params.sourceFile);
  const bound = ts.isIdentifier(params.element) ? params.importSources.get(params.element.text) : undefined;
  return { expression, source: bound === undefined ? null : bound, key: params.key };
}

interface MembersResult {
  form: "list" | "record";
  members: RegistryMember[];
}

function readMembers(params: {
  expression: ts.Expression;
  sourceFile: ts.SourceFile;
  importSources: Map<string, string | null>;
}): MembersResult | null {
  if (ts.isArrayLiteralExpression(params.expression)) {
    const members = params.expression.elements.map((element) =>
      memberOf({ element, sourceFile: params.sourceFile, importSources: params.importSources, key: null }),
    );
    return { form: "list", members };
  }
  if (ts.isObjectLiteralExpression(params.expression)) {
    const members: RegistryMember[] = [];
    for (const property of params.expression.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = property.name;
      const key = ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
      if (key === null) continue;
      members.push(
        memberOf({
          element: property.initializer,
          sourceFile: params.sourceFile,
          importSources: params.importSources,
          key,
        }),
      );
    }
    return { form: "record", members };
  }
  return null;
}

function readOrdered(expression: ts.Expression | null): boolean {
  if (expression === null) return false;
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  return false;
}

function readEntry(expression: ts.Expression | null): string | null {
  return expression !== null && ts.isStringLiteral(expression) ? expression.text : null;
}

interface ExtractResult {
  registries: RegistryDecl[];
  findings: Finding[];
}

export function extractRegistries(params: {
  sourceFile: ts.SourceFile;
  filePath: string;
  imports: ImportEdge[];
}): ExtractResult {
  const registries: RegistryDecl[] = [];
  const findings: Finding[] = [];
  const importSources = importSourcesOf(params.imports);
  const bindings = registryBindingsOf({ sourceFile: params.sourceFile, imports: params.imports });

  for (const call of findCalls(params.sourceFile, bindings)) {
    const line = params.sourceFile.getLineAndCharacterOfPosition(call.getStart(params.sourceFile)).line + 1;
    const firstArg = call.arguments[0];
    const object = firstArg === undefined ? null : unwrapArgument(firstArg);
    if (object === null || !ts.isObjectLiteralExpression(object)) {
      findings.push({ rule: "scan", path: params.filePath, message: "defineRegistry argument is not an object literal" });
      continue;
    }

    const directoryExpr = propertyOf(object, "directory");
    if (directoryExpr === null || !ts.isStringLiteral(directoryExpr)) {
      findings.push({ rule: "scan", path: params.filePath, message: "defineRegistry directory is not a string literal" });
      continue;
    }
    const directory = resolveRepoRelative({
      fromDir: params.filePath.slice(0, params.filePath.lastIndexOf("/")),
      relative: directoryExpr.text,
    });

    const membersExpr = propertyOf(object, "members");
    const membersResult =
      membersExpr === null
        ? null
        : readMembers({ expression: membersExpr, sourceFile: params.sourceFile, importSources });
    if (membersResult === null) {
      findings.push({
        rule: "scan",
        path: params.filePath,
        message: "defineRegistry members is not an array or object literal",
      });
      continue;
    }

    registries.push({
      directory,
      entry: readEntry(propertyOf(object, "entry")),
      ordered: readOrdered(propertyOf(object, "ordered")),
      form: membersResult.form,
      members: membersResult.members,
      line,
    });
  }

  return { registries, findings };
}

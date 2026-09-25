/**
 * Hand-rolled Markdown in box-authored views (`views/*.tsx`) is an error.
 *
 * Card text renders through `Markdown` from `beebox/view-widgets`, the app's
 * own renderer, so Markdoc tags, refs, images, and todos behave the same in a
 * box view as on the card's page (`docs/plans/todos-ui.md`, Track 6). A view
 * that splits a body into paragraphs, strips `{% … %}` tags with a regex, or
 * brings its own Markdown library loses all of that without anyone noticing.
 *
 * A TypeScript-AST check (the compiler API, not regexes over source) of three
 * rules. A view fails when it:
 *
 * 1. imports a Markdown library (`MARKDOWN_LIBRARIES`, any subpath, by
 *    `import`, `export … from`, `import()`, or `require()`);
 * 2. has the Markdoc delimiter `{%` in a string, template, or regex literal
 *    (backslashes are ignored in a regex, so `/\{%/` counts);
 * 3. reads a card's `body` anywhere except as the children of `<Markdown>`
 *    (imported from `beebox/view-widgets`, under any local name; the left of
 *    `??` and `!`/`as` wrappers pass through) or in a
 *    truthiness test: a condition, a `!`/`typeof` operand, the left of
 *    `&&`, any operand of `&&`/`||` that is itself a test, or an
 *    `=== / !== / == / !=` comparison with `undefined` or `null`.
 *
 * What counts as a card's `body`: any `.body` or `["body"]` read, except on
 * `document` / `….document`; and any local bound by destructuring a `body`
 * property (`const { body } = card`, `({ body }) => …`), whose uses are then
 * held to the same rule.
 *
 * Not caught: text assembled at run time (`"{" + "%"`, a computed key equal
 * to `"body"`), a regex that matches `{%` without writing it (`/[{]%/`), a
 * whole card handed to code outside the view file, a destructured `body`
 * local shadowed by an unrelated variable of the same name (it is flagged
 * when it should not be), and Markdown libraries not on the list.
 */

import { promises as fs } from "node:fs";
import type * as TS from "typescript";

type Ts = typeof TS;

/** Package names (and families, with a trailing `-`) a view may not import. */
const MARKDOWN_LIBRARIES = [
  "marked", "remark", "remark-", "markdown-it", "markdown-it-", "showdown", "micromark", "micromark-",
  "react-markdown", "markdown-to-jsx", "commonmark", "snarkdown", "@mdx-js/", "@markdoc/markdoc",
];

export const VIEW_MARKDOWN_MESSAGE =
  "Render card text with `Markdown` from `beebox/view-widgets`. If it lacks something this view needs, say so in `_config/feedback/`.";

export interface ViewMarkdownProblem {
  /** 1-based source line. */
  line: number;
  /** What was found, e.g. "imports `marked`". */
  what: string;
}

function isMarkdownLibrary(specifier: string): boolean {
  return MARKDOWN_LIBRARIES.some((name) => {
    if (name.endsWith("-") || name.endsWith("/")) return specifier.startsWith(name);
    return specifier === name || specifier.startsWith(`${name}/`);
  });
}

/** A module specifier this node imports, if it is an import-shaped node with a literal one. */
function importedSpecifier(ts: Ts, node: TS.Node): string | null {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
    return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    const isLoader = callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require");
    const first = node.arguments[0];
    if (isLoader && first !== undefined && ts.isStringLiteralLike(first)) return first.text;
  }
  return null;
}

/** The literal text a string, template part, or regex node carries; null for anything else. */
function literalText(ts: Ts, node: TS.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return node.text;
  if (ts.isRegularExpressionLiteral(node)) return node.text.replaceAll("\\", "");
  return null;
}

/** Local names `Markdown` is imported under from `beebox/view-widgets`. */
function markdownTagNames(ts: Ts, file: TS.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== "beebox/view-widgets") continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === "Markdown") names.add(element.name.text);
    }
  }
  return names;
}

/** Whether `node`'s parent passes its value through: parentheses, `!`, `as`, `satisfies`, or the left of `??`. */
function passesThrough(ts: Ts, node: TS.Node): boolean {
  const parent = node.parent;
  if (ts.isParenthesizedExpression(parent) || ts.isNonNullExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent)) return true;
  return ts.isBinaryExpression(parent) && parent.left === node && parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken;
}

/** Step out of wrappers that pass a value through. */
function outermost(ts: Ts, node: TS.Node): TS.Node {
  let current = node;
  while (passesThrough(ts, current)) current = current.parent;
  return current;
}

function isNullish(ts: Ts, node: TS.Expression): boolean {
  return node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === "undefined");
}

/** Whether `node`'s value is used only as a truth test. */
function isTest(ts: Ts, start: TS.Node): boolean {
  const node = outermost(ts, start);
  const parent = node.parent;
  if (ts.isConditionalExpression(parent)) return parent.condition === node;
  if (ts.isIfStatement(parent) || ts.isWhileStatement(parent) || ts.isDoStatement(parent)) return parent.expression === node;
  if (ts.isForStatement(parent)) return parent.condition === node;
  if (ts.isPrefixUnaryExpression(parent)) return parent.operator === ts.SyntaxKind.ExclamationToken;
  if (ts.isTypeOfExpression(parent)) return true;
  if (!ts.isBinaryExpression(parent)) return false;
  const op = parent.operatorToken.kind;
  if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
    return (op === ts.SyntaxKind.AmpersandAmpersandToken && parent.left === node) || isTest(ts, parent);
  }
  const comparisons = [
    ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
  ];
  if (!comparisons.includes(op)) return false;
  return isNullish(ts, parent.left === node ? parent.right : parent.left);
}

/** Whether `node` is the children of a `<Markdown>` element (expression child, or `children=` attribute). */
function isMarkdownChildren({ ts, tagNames }: { ts: Ts; tagNames: Set<string> }, start: TS.Node): boolean {
  const node = outermost(ts, start);
  const expression = node.parent;
  if (!ts.isJsxExpression(expression)) return false;
  const holder = expression.parent;
  if (ts.isJsxElement(holder)) return tagNames.has(holder.openingElement.tagName.getText());
  if (ts.isJsxAttribute(holder) && holder.name.getText() === "children") {
    const element = holder.parent.parent;
    return (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) && tagNames.has(element.tagName.getText());
  }
  return false;
}

function isDocument(ts: Ts, node: TS.Expression): boolean {
  const target = ts.isPropertyAccessExpression(node) ? node.name : node;
  return ts.isIdentifier(target) && target.text === "document";
}

/** A `.body` / `["body"]` read (not an assignment target), on something other than `document`. */
function isBodyAccess(ts: Ts, node: TS.Node): boolean {
  const isAccess = (ts.isPropertyAccessExpression(node) && node.name.text === "body")
    || (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === "body");
  if (!isAccess || isDocument(ts, node.expression)) return false;
  const outer = outermost(ts, node);
  const parent = outer.parent;
  return !(ts.isBinaryExpression(parent) && parent.left === outer && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken);
}

/** Locals bound by destructuring a `body` property (not from `document`). */
function destructuredBodyNames(ts: Ts, file: TS.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: TS.Node): void => {
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name;
      const declaration = node.parent.parent;
      const fromDocument = ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined && isDocument(ts, declaration.initializer);
      if (ts.isIdentifier(key) && key.text === "body" && ts.isIdentifier(node.name) && !fromDocument) names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

/** An identifier that reads a local (not a declaration, property name, or JSX attribute name). */
function isLocalRead(ts: Ts, node: TS.Identifier): boolean {
  const parent = node.parent;
  if (ts.isBindingElement(parent) || ts.isVariableDeclaration(parent) || ts.isParameter(parent)) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isJsxAttribute(parent) || ts.isPropertySignature(parent) || ts.isImportSpecifier(parent)) return false;
  if (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) return false;
  return true;
}

/** Every problem in one view's source. */
function findProblems(ts: Ts, source: string): ViewMarkdownProblem[] {
  const file = ts.createSourceFile("view.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const tagNames = markdownTagNames(ts, file);
  const bodyLocals = destructuredBodyNames(ts, file);
  const problems: ViewMarkdownProblem[] = [];
  const report = (node: TS.Node, what: string): void => {
    problems.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, what });
  };
  const bodyUse = (node: TS.Node, what: string): void => {
    if (!isMarkdownChildren({ ts, tagNames }, node) && !isTest(ts, node)) report(node, what);
  };
  const visit = (node: TS.Node): void => {
    const specifier = importedSpecifier(ts, node);
    if (specifier !== null && isMarkdownLibrary(specifier)) report(node, `imports \`${specifier}\``);
    if (literalText(ts, node)?.includes("{%") === true) report(node, "has the Markdoc delimiter `{%` in a literal");
    if (isBodyAccess(ts, node)) bodyUse(node, `reads \`${node.getText(file)}\` outside \`<Markdown>\``);
    if (ts.isIdentifier(node) && bodyLocals.has(node.text) && isLocalRead(ts, node)) {
      bodyUse(node, `uses \`${node.text}\` (a card's destructured \`body\`) outside \`<Markdown>\``);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return problems;
}

/** Problems in a view's source text. Loads the TypeScript compiler on first use. */
export async function checkViewMarkdown(source: string): Promise<ViewMarkdownProblem[]> {
  // Loaded here, not at module scope: the compiler is ~8 MB of JS, and the
  // CLI imports every command module eagerly (see view-typecheck.ts).
  const ts = await import("typescript");
  return findProblems(ts, source);
}

/**
 * The edit-time error for a view file (absolute path): null when the view
 * renders card text only through `Markdown`, else the problems and the rule.
 * An unreadable view is the compile check's concern and passes here.
 */
export async function lintViewMarkdown(viewAbsPath: string): Promise<string | null> {
  let source: string;
  try {
    source = await fs.readFile(viewAbsPath, "utf-8");
  } catch (_e) {
    return null;
  }
  const problems = await checkViewMarkdown(source);
  if (problems.length === 0) return null;
  const lines = problems.map((p) => `  line ${String(p.line)}: ${p.what}`);
  return ["View renders Markdown by hand:", ...lines, VIEW_MARKDOWN_MESSAGE].join("\n");
}

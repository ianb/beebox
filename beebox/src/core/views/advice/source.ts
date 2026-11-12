/**
 * Source rules of `bbx view check` advice: patterns in one view file that the
 * views doc forbids (docs/implemented-plans/box-view-guidance-and-checks.md, Track 3).
 *
 * - `enter-without-ime-check`: `ime-enter.ts`.
 * - `clickable-non-control`: a JSX `div`, `span`, `li`, `td`, `tr` or `p`
 *   with `onClick`, no `role`, and no spread attribute (which may carry one).
 * - `viewport-height`: a literal containing `100vh`, or a class token that
 *   `personal-vibe-check/rules/no-viewport-height-class.ts` bans.
 * - `date-string-parse`: `new Date(x)` with one argument that may be text: a
 *   string or template, a `+` with a string operand, a name, or a property
 *   read. A number, other arithmetic, a call, or a name ending in `Ms` (a
 *   `ViewFile`'s `mtimeMs`) is not reported. A plain name holding a number
 *   is, by design.
 * - `utc-today`: `.toISOString()` cut to the date by `.slice(0, 10)`,
 *   `.substring(0, 10)`, or `.split("T")[0]`.
 */

import type * as TS from "../../../lib/typescript/syntax.js";
import { advice, type AdviceRule, type ViewAdvice } from "./types.js";
import { unguardedEnterTests } from "./ime-enter.js";
import { stringLiteralText } from "../literal-text.js";

type Ts = typeof TS;

const CLICKABLE_TAGS = new Set(["div", "span", "li", "td", "tr", "p"]);
/** `no-viewport-height-class.ts`'s pattern, applied to a token without its variant prefix. */
const VIEWPORT_HEIGHT_CLASS = /^!?(?:min-|max-)?h-(?:screen|\[100vh])$/;

function unwrap(ts: Ts, node: TS.Expression): TS.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

function isClickableNonControl(ts: Ts, node: TS.Node): boolean {
  if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return false;
  if (!ts.isIdentifier(node.tagName) || !CLICKABLE_TAGS.has(node.tagName.text)) return false;
  const props = node.attributes.properties;
  if (props.some((p) => ts.isJsxSpreadAttribute(p))) return false;
  const names = props.flatMap((p) => (ts.isJsxAttribute(p) ? [p.name.getText()] : []));
  return names.includes("onClick") && !names.includes("role");
}

function hasViewportHeight(text: string): boolean {
  if (text.includes("100vh")) return true;
  return text.split(/\s+/).some((token) => VIEWPORT_HEIGHT_CLASS.test(token.slice(token.lastIndexOf(":") + 1)));
}

function isStringish(ts: Ts, node: TS.Expression): boolean {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node);
}

/** A name that holds epoch milliseconds by convention (`mtimeMs`). */
function isMsName(name: string): boolean {
  return name.endsWith("Ms");
}

/** `new Date(x)` with one argument that may be date text. */
function isDateStringParse(ts: Ts, node: TS.Node): boolean {
  if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== "Date") return false;
  const args = node.arguments ?? [];
  const [first] = args;
  if (args.length !== 1 || first === undefined) return false;
  const arg = unwrap(ts, first);
  if (isStringish(ts, arg)) return true;
  if (ts.isBinaryExpression(arg) && arg.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return isStringish(ts, unwrap(ts, arg.left)) || isStringish(ts, unwrap(ts, arg.right));
  }
  if (ts.isIdentifier(arg)) return !isMsName(arg.text);
  if (ts.isPropertyAccessExpression(arg)) return !isMsName(arg.name.getText());
  if (ts.isElementAccessExpression(arg)) {
    const key = arg.argumentExpression;
    return !(ts.isStringLiteralLikeNode(key) && isMsName(key.text));
  }
  return false;
}

function isToIsoString(ts: Ts, node: TS.Expression): boolean {
  const call = unwrap(ts, node);
  return ts.isCallExpression(call) && call.arguments.length === 0
    && ts.isPropertyAccessExpression(call.expression) && call.expression.name.getText() === "toISOString";
}

function isZero(ts: Ts, node: TS.Expression | undefined): boolean {
  return node !== undefined && ts.isNumericLiteral(node) && Number(node.text) === 0;
}

function isTen(ts: Ts, node: TS.Expression | undefined): boolean {
  return node !== undefined && ts.isNumericLiteral(node) && Number(node.text) === 10;
}

/** `<iso>.slice(0, 10)`, `<iso>.substring(0, 10)`, or `<iso>.split("T")[0]`. */
function isUtcToday(ts: Ts, node: TS.Node): boolean {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const method = node.expression.name.getText();
    const [start, end] = node.arguments;
    return (method === "slice" || method === "substring") && node.arguments.length === 2 && isZero(ts, start) && isTen(ts, end)
      && isToIsoString(ts, node.expression.expression);
  }
  if (ts.isElementAccessExpression(node) && isZero(ts, node.argumentExpression)) {
    const split = unwrap(ts, node.expression);
    if (!ts.isCallExpression(split) || !ts.isPropertyAccessExpression(split.expression) || split.expression.name.getText() !== "split") return false;
    const [separator] = split.arguments;
    return separator !== undefined && ts.isStringLiteral(separator) && separator.text === "T" && isToIsoString(ts, split.expression.expression);
  }
  return false;
}

/** The source advice for one view file, `where` as `<fileName>:<line>`. */
export function sourceAdvice({ ts, parse }: { ts: Ts; parse: TS.Parse }, { fileName, source }: { fileName: string; source: string }): ViewAdvice[] {
  const file = parse({ fileName, sourceText: source });
  const found: ViewAdvice[] = [];
  const report = (rule: AdviceRule, node: TS.Node): void => {
    found.push(advice(rule, `${fileName}:${String(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1)}`));
  };
  for (const hit of unguardedEnterTests(ts, file)) report("enter-without-ime-check", hit);
  const visit = (node: TS.Node): void => {
    if (isClickableNonControl(ts, node)) report("clickable-non-control", node);
    const text = stringLiteralText(ts, node);
    if (text !== null && hasViewportHeight(text)) report("viewport-height", node);
    if (isDateStringParse(ts, node)) report("date-string-parse", node);
    if (isUtcToday(ts, node)) report("utc-today", node);
    node.forEachChild(visit);
  };
  visit(file);
  return found;
}

/**
 * ESLint rule: a keydown handler that acts on Enter must skip IME composition.
 *
 * Japanese, Chinese, Korean and other input methods use Enter to confirm the
 * composed text. A handler that submits on Enter without checking
 * `event.isComposing` (plus `keyCode === 229`, which Safari sends on the
 * composition-ending Enter) submits half-typed text. Ported from the
 * `ime-safe-enter-submit` static matcher in GoogleChrome/modern-web-guidance
 * (`src/analyzing/rules/ime-safe-enter-submit.ts`, Apache-2.0), narrowed to
 * what an AST rule can decide without a verifier.
 *
 * Checked handlers:
 *   - a function given to a JSX `onKeyDown` / `onKeyPress` attribute, inline
 *     or as a same-file function or const;
 *   - a function given to `addEventListener("keydown" | "keypress", fn)`.
 *
 * A handler is reported when it compares `.key` or `.code` with "Enter" (or
 * has `case "Enter"` in a switch) and no composition check controls that
 * test. A check is `isComposing` (a call such as `isComposing(e.nativeEvent)`
 * or a member `e.isComposing`), `229`, or the "Process" key, and it controls
 * the test when it is negated in the test's own `&&` chain or an enclosing
 * `if`, or is an early `if (<check>) return;` before it in an enclosing block.
 * A check that is only logged, or that comes after the action, does not count.
 *
 * Deliberately not reported:
 *   - handlers on elements with a button-like role or a native `<button>` /
 *     `<a>`: there Enter activates, no text is composed;
 *   - an Enter test that also requires Ctrl, Meta or Alt;
 *   - an Enter branch that only calls preventDefault/stopPropagation (it
 *     suppresses a newline, it does not act).
 *
 * Limitations: the rule cannot see which element a component renders, so a
 * `TextField onKeyDown` and a `Button onKeyDown` look the same; a handler
 * imported from another module is not checked; `addEventListener` handlers
 * get no element exemption.
 */

import type { Rule } from "eslint";
import type * as ESTree from "estree";

const KEY_EVENT_PROPS = new Set(["onKeyDown", "onKeyPress"]);
const KEY_EVENT_TYPES = new Set(["keydown", "keypress"]);
const ACTIVATION_ROLES = new Set(["button", "link", "menuitem", "option", "tab", "switch", "checkbox", "radio"]);
const ACTIVATION_ELEMENTS = new Set(["button", "a"]);
const MODIFIER_KEYS = new Set(["ctrlKey", "metaKey", "altKey"]);
const SUPPRESS_CALLS = new Set(["preventDefault", "stopPropagation", "stopImmediatePropagation"]);

type FunctionNode = ESTree.ArrowFunctionExpression | ESTree.FunctionExpression | ESTree.FunctionDeclaration;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** JSX nodes and parent links come from the parser extension, outside `estree`; read them through this guard. */
function isNode(value: unknown): value is ESTree.Node {
  return isRecord(value) && typeof value.type === "string";
}

function parentOf(node: ESTree.Node): ESTree.Node | null {
  const parent: unknown = "parent" in node ? node.parent : undefined;
  return isNode(parent) ? parent : null;
}

function isFunctionNode(node: unknown): node is FunctionNode {
  return (
    isRecord(node) &&
    (node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionExpression" ||
      node.type === "FunctionDeclaration")
  );
}

function isEnterLiteral(node: ESTree.Node | null | undefined): boolean {
  return node?.type === "Literal" && node.value === "Enter";
}

function isKeyMember(node: ESTree.Node): boolean {
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.property.type === "Identifier" &&
    (node.property.name === "key" || node.property.name === "code")
  );
}

function isEnterComparison(node: ESTree.Node): node is ESTree.BinaryExpression {
  if (node.type !== "BinaryExpression" || (node.operator !== "===" && node.operator !== "==")) return false;
  const left = node.left;
  return (
    (isNode(left) && isKeyMember(left) && isEnterLiteral(node.right)) ||
    (isKeyMember(node.right) && isNode(left) && isEnterLiteral(left))
  );
}

/** Depth-first walk over a handler body. Nested functions are walked too: a guard helper inside the handler
 * still belongs to it. */
function walk(node: unknown, visit: (n: ESTree.Node) => void): void {
  if (!isNode(node)) return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    if (Array.isArray(value)) for (const child of value) walk(child, visit);
    else walk(value, visit);
  }
}

/** Whether an expression reads a composition signal: `isComposing` (call or member), `229`, or "Process". */
function containsGuard(node: ESTree.Node): boolean {
  let found = false;
  walk(node, (n) => {
    if (found) return;
    if (n.type === "Identifier" && n.name === "isComposing") found = true;
    else if (n.type === "Literal" && (n.value === 229 || n.value === "Process")) found = true;
  });
  return found;
}

/** `!isComposing(e)`, `!e.isComposing`, `e.keyCode !== 229`: true only when no composition is active. */
function isNegatedGuard(node: ESTree.Node): boolean {
  if (node.type === "UnaryExpression" && node.operator === "!") return containsGuard(node.argument);
  if (node.type === "BinaryExpression" && (node.operator === "!==" || node.operator === "!=")) return containsGuard(node);
  return false;
}

function andOperands(node: ESTree.Node): ESTree.Node[] {
  if (node.type === "LogicalExpression" && node.operator === "&&") return [...andOperands(node.left), ...andOperands(node.right)];
  return [node];
}

/** `if (<reads composition>) return;` — the early exit that makes everything after it safe. */
function isEarlyReturnGuard(statement: ESTree.Node): boolean {
  if (statement.type !== "IfStatement" || statement.alternate) return false;
  if (!containsGuard(statement.test) || andOperands(statement.test).some(isNegatedGuard)) return false;
  const body = statement.consequent.type === "BlockStatement" ? statement.consequent.body : [statement.consequent];
  return body.at(-1)?.type === "ReturnStatement";
}

function statementList(node: ESTree.Node): ESTree.Node[] | null {
  if (node.type === "BlockStatement") return node.body;
  if (node.type === "SwitchCase") return node.consequent;
  return null;
}

/**
 * Whether the composition check controls this Enter test: a negated guard in
 * its own `&&` chain or an enclosing `if`, or an early-return guard before it
 * in an enclosing block. A guard anywhere else (logged, or after the action)
 * does not count.
 */
function isGuarded(target: ESTree.Node, fn: FunctionNode): boolean {
  if (target.type === "BinaryExpression") {
    let chain: ESTree.Node = target;
    for (let up = parentOf(chain); up?.type === "LogicalExpression" && up.operator === "&&"; up = parentOf(up)) chain = up;
    if (andOperands(chain).some(isNegatedGuard)) return true;
  }
  let current: ESTree.Node = target;
  for (let up = parentOf(current); up !== null && current !== fn; current = up, up = parentOf(up)) {
    if (up.type === "IfStatement" && up.consequent === current && andOperands(up.test).some(isNegatedGuard)) return true;
    const list = statementList(up);
    if (list !== null) {
      const index = list.indexOf(current);
      if (list.slice(0, Math.max(index, 0)).some(isEarlyReturnGuard)) return true;
    }
  }
  return false;
}

/** Operands of the `&&` chain the comparison sits in, so `e.metaKey && e.key === "Enter"` is seen as one test. */
function andChainOperands(comparison: ESTree.Node): ESTree.Node[] {
  let top: ESTree.Node = comparison;
  for (let up = parentOf(top); up?.type === "LogicalExpression" && up.operator === "&&"; up = parentOf(up)) top = up;
  const operands: ESTree.Node[] = [];
  const collect = (n: ESTree.Node): void => {
    if (n.type === "LogicalExpression" && n.operator === "&&") {
      collect(n.left);
      collect(n.right);
    } else operands.push(n);
  };
  collect(top);
  return operands;
}

function requiresModifier(comparison: ESTree.Node): boolean {
  return andChainOperands(comparison).some(
    (op) =>
      op.type === "MemberExpression" &&
      !op.computed &&
      op.property.type === "Identifier" &&
      MODIFIER_KEYS.has(op.property.name),
  );
}

function isSuppressOnly(statement: ESTree.Statement): boolean {
  const body = statement.type === "BlockStatement" ? statement.body : [statement];
  return body.every((s) => {
    if (s.type === "ReturnStatement" || s.type === "BreakStatement") return true;
    if (s.type !== "ExpressionStatement" || s.expression.type !== "CallExpression") return false;
    const callee = s.expression.callee;
    return (
      callee.type === "MemberExpression" &&
      callee.property.type === "Identifier" &&
      SUPPRESS_CALLS.has(callee.property.name)
    );
  });
}

/** The first unguarded Enter test in the handler that acts, or null. */
function findActingEnterTest(fn: FunctionNode): ESTree.Node | null {
  let hit: ESTree.Node | null = null;
  walk(fn.body, (n) => {
    if (hit !== null) return;
    if (isEnterComparison(n)) {
      if (requiresModifier(n)) return;
      let owner = parentOf(n);
      while (owner?.type === "LogicalExpression") owner = parentOf(owner);
      if (owner?.type === "IfStatement" && isSuppressOnly(owner.consequent)) return;
      if (!isGuarded(n, fn)) hit = n;
    } else if (n.type === "SwitchCase" && isEnterLiteral(n.test)) {
      const disc = parentOf(n);
      if (disc?.type !== "SwitchStatement" || !isKeyMember(disc.discriminant)) return;
      const acting = n.consequent.filter((s) => s.type !== "BreakStatement");
      if (acting.length > 0 && !acting.every((s) => isSuppressOnly(s)) && !isGuarded(disc, fn)) hit = n;
    }
  });
  return hit;
}

/** Resolve an identifier handler to a function declared in an enclosing scope of the same file. */
function resolveLocalFunction(context: Rule.RuleContext, id: ESTree.Identifier): FunctionNode | null {
  let scope: ReturnType<typeof context.sourceCode.getScope> | null = context.sourceCode.getScope(id);
  while (scope !== null) {
    const variable = scope.set.get(id.name);
    if (variable !== undefined) {
      for (const def of variable.defs) {
        if (isFunctionNode(def.node)) return def.node;
        if (def.node.type === "VariableDeclarator" && isFunctionNode(def.node.init)) return def.node.init;
      }
      return null;
    }
    scope = scope.upper;
  }
  return null;
}

function stringAttr(opening: Record<string, unknown>, name: string): string | null {
  const attrs = Array.isArray(opening.attributes) ? opening.attributes : [];
  for (const attr of attrs) {
    if (!isRecord(attr) || attr.type !== "JSXAttribute" || !isRecord(attr.name) || attr.name.name !== name) continue;
    const value = attr.value;
    if (isRecord(value) && value.type === "Literal" && typeof value.value === "string") return value.value;
    return null;
  }
  return null;
}

function isActivationElement(opening: Record<string, unknown>): boolean {
  const role = stringAttr(opening, "role");
  if (role !== null && ACTIVATION_ROLES.has(role)) return true;
  const name = opening.name;
  return isRecord(name) && name.type === "JSXIdentifier" && typeof name.name === "string" && ACTIVATION_ELEMENTS.has(name.name);
}

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require an IME composition check in keydown handlers that act on Enter",
    },
    schema: [],
    messages: {
      missingCompositionCheck:
        "This keydown handler acts on Enter without checking IME composition. Return early when `isComposing(event.nativeEvent)` (or `event.isComposing` plus `keyCode === 229` for Safari) is true, so Enter that confirms Japanese/Chinese/Korean input does not submit.",
    },
  },
  create(context) {
    function check(fn: FunctionNode | null): void {
      if (fn === null) return;
      const hit = findActingEnterTest(fn);
      if (hit !== null) context.report({ node: hit, messageId: "missingCompositionCheck" });
    }

    function handlerFunction(expr: ESTree.Node): FunctionNode | null {
      if (isFunctionNode(expr)) return expr;
      if (expr.type === "Identifier") return resolveLocalFunction(context, expr);
      return null;
    }

    return {
      JSXAttribute(node: unknown) {
        if (!isRecord(node) || !isRecord(node.name) || typeof node.name.name !== "string") return;
        if (!KEY_EVENT_PROPS.has(node.name.name)) return;
        const opening = node.parent;
        if (isRecord(opening) && isActivationElement(opening)) return;
        const value = node.value;
        if (!isRecord(value) || value.type !== "JSXExpressionContainer" || !isNode(value.expression)) return;
        check(handlerFunction(value.expression));
      },
      CallExpression(node: ESTree.CallExpression) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier") return;
        if (callee.property.name !== "addEventListener") return;
        const [type, listener] = node.arguments;
        if (type?.type !== "Literal" || typeof type.value !== "string" || !KEY_EVENT_TYPES.has(type.value)) return;
        if (listener === undefined || listener.type === "SpreadElement") return;
        check(handlerFunction(listener));
      },
    };
  },
};

export default rule;

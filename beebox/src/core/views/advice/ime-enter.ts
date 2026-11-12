/**
 * A keydown handler that acts on Enter must skip IME composition: Japanese,
 * Chinese and Korean input use Enter to confirm the composed text.
 *
 * A port of the ESLint rule `personal-vibe-check/rules/ime-safe-enter.ts` to
 * the TypeScript syntax tree, because no ESLint runs in a box and the preset
 * cannot reach a box at runtime (docs/plans/box-view-guidance-and-checks.md,
 * Track 3, "Why not one shared implementation"). The decision is the same,
 * function for function; both run the cases in
 * `personal-vibe-check/rules/test/ime-safe-enter.cases.ts`, so a change to
 * one that the other lacks fails a test. Change both together.
 *
 * Checked handlers: a function given to a JSX `onKeyDown` / `onKeyPress`
 * attribute (inline, or a same-file function or const), or to
 * `addEventListener("keydown" | "keypress", fn)`. A handler is reported when
 * it compares `.key` / `.code` with "Enter" (or has `case "Enter"`) and no
 * composition check controls that test: a negated check in the test's own
 * `&&` chain or an enclosing `if`, or an early `if (<check>) return;` before
 * it. Not reported: handlers on `<button>`, `<a>`, or an element with a
 * button-like role; an Enter test that also requires Ctrl, Meta or Alt; an
 * Enter branch that only suppresses (preventDefault, a bare return).
 *
 * The ESTree rule sees no parentheses; this port steps over them
 * (`unwrap`, `parentOf`).
 */

import type * as TS from "../../../lib/typescript/syntax.js";

type Ts = typeof TS;

const KEY_EVENT_PROPS = new Set(["onKeyDown", "onKeyPress"]);
const KEY_EVENT_TYPES = new Set(["keydown", "keypress"]);
const ACTIVATION_ROLES = new Set(["button", "link", "menuitem", "option", "tab", "switch", "checkbox", "radio"]);
const ACTIVATION_ELEMENTS = new Set(["button", "a"]);
const MODIFIER_KEYS = new Set(["ctrlKey", "metaKey", "altKey"]);
const SUPPRESS_CALLS = new Set(["preventDefault", "stopPropagation", "stopImmediatePropagation"]);

type FunctionNode = TS.ArrowFunction | TS.FunctionExpression | TS.FunctionDeclaration;
type Polarity = "composing" | "notComposing";

/** The rule over one file; `ts` is the syntax module. */
class ImeEnter {
  constructor(private readonly ts: Ts) {}

  unwrap(node: TS.Node): TS.Node {
    let current = node;
    while (this.ts.isParenthesizedExpression(current)) current = current.expression;
    return current;
  }

  /** The parent, past parentheses; null at the file. */
  parentOf(node: TS.Node): TS.Node | null {
    if (this.ts.isSourceFile(node)) return null;
    let parent = node.parent;
    while (this.ts.isParenthesizedExpression(parent)) parent = parent.parent;
    return parent;
  }

  isFunctionNode(node: TS.Node): node is FunctionNode {
    return this.ts.isArrowFunction(node) || this.ts.isFunctionExpression(node) || this.ts.isFunctionDeclaration(node);
  }

  isOperator(node: TS.Node, ...ops: TS.SyntaxKind[]): node is TS.BinaryExpression {
    return this.ts.isBinaryExpression(node) && ops.includes(node.operatorToken.kind);
  }

  memberName(node: TS.Node): string | null {
    return this.ts.isPropertyAccessExpression(node) && this.ts.isIdentifier(node.name) ? node.name.text : null;
  }

  isStringValue(node: TS.Node, value: string): boolean {
    const inner = this.unwrap(node);
    return this.ts.isStringLiteral(inner) && inner.text === value;
  }

  isKeyMember(node: TS.Node): boolean {
    const name = this.memberName(this.unwrap(node));
    return name === "key" || name === "code";
  }

  isEnterComparison(node: TS.Node): node is TS.BinaryExpression {
    const { SyntaxKind } = this.ts;
    if (!this.isOperator(node, SyntaxKind.EqualsEqualsEqualsToken, SyntaxKind.EqualsEqualsToken)) return false;
    return (this.isKeyMember(node.left) && this.isStringValue(node.right, "Enter"))
      || (this.isKeyMember(node.right) && this.isStringValue(node.left, "Enter"));
  }

  /** `isComposing(e)` / `isComposing(e.nativeEvent)`, or a member `e.isComposing`. */
  isCompositionRead(node: TS.Node): boolean {
    if (this.ts.isCallExpression(node)) return this.ts.isIdentifier(node.expression) && node.expression.text === "isComposing";
    return this.memberName(node) === "isComposing";
  }

  /** `e.keyCode`, `e.which`, `e.key`: the side compared with 229 or "Process". */
  isKeyField(node: TS.Node): boolean {
    const name = this.memberName(this.unwrap(node));
    return name !== null && ["keyCode", "which", "key"].includes(name);
  }

  /** What an expression being true says about composition (see the ESLint rule's `polarity`). */
  polarity(start: TS.Node): Polarity | null {
    const { ts } = this;
    const { SyntaxKind } = ts;
    const node = this.unwrap(start);
    if (this.isCompositionRead(node)) return "composing";
    if (ts.isPrefixUnaryExpression(node) && node.operator === SyntaxKind.ExclamationToken) return flip(this.polarity(node.operand));
    if (this.isOperator(node, SyntaxKind.BarBarToken)) {
      return this.polarity(node.left) === "composing" || this.polarity(node.right) === "composing" ? "composing" : null;
    }
    const equality = [SyntaxKind.EqualsEqualsEqualsToken, SyntaxKind.EqualsEqualsToken, SyntaxKind.ExclamationEqualsEqualsToken, SyntaxKind.ExclamationEqualsToken];
    if (!this.isOperator(node, ...equality)) return null;
    const op = node.operatorToken.kind;
    const negate = op === SyntaxKind.ExclamationEqualsEqualsToken || op === SyntaxKind.ExclamationEqualsToken;
    const sides: [TS.Node, TS.Node][] = [[this.unwrap(node.left), node.right], [this.unwrap(node.right), node.left]];
    for (const [value, other] of sides) {
      let p: Polarity | null = null;
      if (value.kind === SyntaxKind.TrueKeyword) p = this.polarity(other);
      else if (value.kind === SyntaxKind.FalseKeyword) p = flip(this.polarity(other));
      else if (((ts.isNumericLiteral(value) && Number(value.text) === 229) || (ts.isStringLiteral(value) && value.text === "Process")) && this.isKeyField(other)) p = "composing";
      if (p !== null) return negate ? flip(p) : p;
    }
    return null;
  }

  andOperands(start: TS.Node): TS.Node[] {
    const node = this.unwrap(start);
    if (this.isOperator(node, this.ts.SyntaxKind.AmpersandAmpersandToken)) return [...this.andOperands(node.left), ...this.andOperands(node.right)];
    return [node];
  }

  /** The top of the `&&` chain `node` sits in. */
  andChainTop(node: TS.Node): TS.Node {
    let top = node;
    for (let up = this.parentOf(top); up !== null && this.isOperator(up, this.ts.SyntaxKind.AmpersandAmpersandToken); up = this.parentOf(up)) top = up;
    return top;
  }

  isNegatedGuard(node: TS.Node): boolean {
    return this.polarity(node) === "notComposing";
  }

  /** `if (<composition>) return;`, the early exit that makes everything after it safe. */
  isEarlyReturnGuard(statement: TS.Node): boolean {
    const { ts } = this;
    if (!ts.isIfStatement(statement) || statement.elseStatement !== undefined) return false;
    if (this.polarity(statement.expression) !== "composing") return false;
    const then = statement.thenStatement;
    const body = ts.isBlock(then) ? then.statements : [then];
    const last = body.at(-1);
    return last !== undefined && ts.isReturnStatement(last);
  }

  statementList(node: TS.Node): readonly TS.Node[] | null {
    if (this.ts.isBlock(node) || this.ts.isCaseClause(node) || this.ts.isDefaultClause(node)) return node.statements;
    return null;
  }

  /** Whether a composition check controls this Enter test (see the ESLint rule's `isGuarded`). */
  isGuarded(target: TS.Node, fn: FunctionNode): boolean {
    if (this.isEnterComparison(target) && this.andOperands(this.andChainTop(target)).some((op) => this.isNegatedGuard(op))) return true;
    let current: TS.Node = target;
    for (let up = this.parentOf(current); up !== null && current !== fn; current = up, up = this.parentOf(up)) {
      if (this.ts.isIfStatement(up) && up.thenStatement === current && this.andOperands(up.expression).some((op) => this.isNegatedGuard(op))) return true;
      const list = this.statementList(up);
      if (list !== null) {
        const index = list.indexOf(current);
        if (list.slice(0, Math.max(index, 0)).some((s) => this.isEarlyReturnGuard(s))) return true;
      }
    }
    return false;
  }

  requiresModifier(comparison: TS.Node): boolean {
    return this.andOperands(this.andChainTop(comparison)).some((op) => {
      const name = this.memberName(op);
      return name !== null && MODIFIER_KEYS.has(name);
    });
  }

  isSuppressOnly(statement: TS.Node): boolean {
    const { ts } = this;
    const body = ts.isBlock(statement) ? statement.statements : [statement];
    return body.every((s) => {
      // A bare `return` (or `return true/false`) suppresses; `return submit()` acts.
      if (ts.isReturnStatement(s)) {
        const value = s.expression;
        return value === undefined || value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword;
      }
      if (ts.isBreakStatement(s)) return true;
      if (!ts.isExpressionStatement(s) || !ts.isCallExpression(s.expression)) return false;
      const name = this.memberName(s.expression.expression);
      return name !== null && SUPPRESS_CALLS.has(name);
    });
  }

  /** The first unguarded Enter test in the handler that acts, or null. */
  findActingEnterTest(fn: FunctionNode): TS.Node | null {
    const { ts } = this;
    const { SyntaxKind } = ts;
    const body = fn.body;
    if (body === undefined) return null;
    let hit: TS.Node | null = null;
    const visit = (n: TS.Node): void => {
      if (hit !== null) return;
      if (this.isEnterComparison(n)) {
        if (this.requiresModifier(n)) return;
        let owner = this.parentOf(n);
        while (owner !== null && this.isOperator(owner, SyntaxKind.AmpersandAmpersandToken, SyntaxKind.BarBarToken, SyntaxKind.QuestionQuestionToken)) owner = this.parentOf(owner);
        if (owner !== null && ts.isIfStatement(owner) && this.isSuppressOnly(owner.thenStatement)) return;
        if (!this.isGuarded(n, fn)) hit = n;
        return;
      }
      if (ts.isCaseClause(n) && this.isStringValue(n.expression, "Enter")) {
        const switchStatement = n.parent.parent;
        if (!ts.isSwitchStatement(switchStatement) || !this.isKeyMember(switchStatement.expression)) return;
        const acting = n.statements.filter((s) => !ts.isBreakStatement(s));
        if (acting.length > 0 && !acting.every((s) => this.isSuppressOnly(s)) && !this.isGuarded(switchStatement, fn)) hit = n;
        return;
      }
      n.forEachChild(visit);
    };
    visit(body);
    return hit;
  }

  /** Names a scope node declares, mapped to the function they hold (null when not a function). */
  declaredHere(scope: TS.Node, name: string): { found: boolean; fn: FunctionNode | null } {
    const { ts } = this;
    if (this.isFunctionNode(scope)) {
      const isParam = scope.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === name);
      return { found: isParam, fn: null };
    }
    const list = ts.isSourceFile(scope) ? scope.statements : this.statementList(scope);
    for (const statement of list ?? []) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return { found: true, fn: statement };
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
          const init = declaration.initializer === undefined ? undefined : this.unwrap(declaration.initializer);
          return { found: true, fn: init !== undefined && this.isFunctionNode(init) ? init : null };
        }
      }
      if (ts.isImportDeclaration(statement) && statement.importClause !== undefined && importBinds(ts, { clause: statement.importClause, name })) return { found: true, fn: null };
    }
    return { found: false, fn: null };
  }

  /** An identifier handler's function, declared in an enclosing scope of the same file. */
  resolveLocalFunction(id: TS.Identifier): FunctionNode | null {
    for (let scope: TS.Node | null = id.parent; scope !== null; scope = this.ts.isSourceFile(scope) ? null : scope.parent) {
      const { found, fn } = this.declaredHere(scope, id.text);
      if (found) return fn;
    }
    return null;
  }

  handlerFunction(expr: TS.Node): FunctionNode | null {
    const node = this.unwrap(expr);
    if (this.isFunctionNode(node)) return node;
    if (this.ts.isIdentifier(node)) return this.resolveLocalFunction(node);
    return null;
  }

  /** The role attribute's string value, or null. */
  roleOf(opening: TS.JsxOpeningElement | TS.JsxSelfClosingElement): string | null {
    const { ts } = this;
    for (const attr of opening.attributes.properties) {
      if (!ts.isJsxAttribute(attr) || attr.name.getText() !== "role") continue;
      return attr.initializer !== undefined && ts.isStringLiteral(attr.initializer) ? attr.initializer.text : null;
    }
    return null;
  }

  isActivationElement(opening: TS.JsxOpeningElement | TS.JsxSelfClosingElement): boolean {
    const role = this.roleOf(opening);
    if (role !== null && ACTIVATION_ROLES.has(role)) return true;
    return this.ts.isIdentifier(opening.tagName) && ACTIVATION_ELEMENTS.has(opening.tagName.text);
  }

  /** The handler a node passes, when it is a key-event attribute or `addEventListener` call. */
  handlerOf(node: TS.Node): FunctionNode | null {
    const { ts } = this;
    if (ts.isJsxAttribute(node)) {
      if (!KEY_EVENT_PROPS.has(node.name.getText())) return null;
      const opening = node.parent.parent;
      if ((ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)) && this.isActivationElement(opening)) return null;
      const value = node.initializer;
      if (value === undefined || !ts.isJsxExpression(value) || value.expression === undefined) return null;
      return this.handlerFunction(value.expression);
    }
    if (ts.isCallExpression(node) && this.memberName(node.expression) === "addEventListener") {
      const [type, listener] = node.arguments;
      if (type === undefined || !ts.isStringLiteral(type) || !KEY_EVENT_TYPES.has(type.text)) return null;
      if (listener === undefined || ts.isSpreadElement(listener)) return null;
      return this.handlerFunction(listener);
    }
    return null;
  }
}

function flip(p: Polarity | null): Polarity | null {
  if (p === null) return null;
  return p === "composing" ? "notComposing" : "composing";
}

function importBinds(ts: Ts, { clause, name }: { clause: TS.ImportClause; name: string }): boolean {
  if (clause.name?.text === name) return true;
  const bindings = clause.namedBindings;
  if (bindings === undefined) return false;
  if (ts.isNamespaceImport(bindings)) return bindings.name.text === name;
  return bindings.elements.some((e) => e.name.text === name);
}

/** Each unguarded Enter test that acts, one per checked handler, in source order. */
export function unguardedEnterTests(ts: Ts, file: TS.SourceFile): TS.Node[] {
  const rule = new ImeEnter(ts);
  const hits: TS.Node[] = [];
  const visit = (node: TS.Node): void => {
    const fn = rule.handlerOf(node);
    const hit = fn === null ? null : rule.findActingEnterTest(fn);
    if (hit !== null) hits.push(hit);
    node.forEachChild(visit);
  };
  visit(file);
  return hits;
}

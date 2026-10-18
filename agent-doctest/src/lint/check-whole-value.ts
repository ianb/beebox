/**
 * `t.check` compares whole values. A check of a length, a boolean, or a
 * comparison throws the value away: on failure it says "expected 4, got 3"
 * and nothing about what is in the list. A JSON string keeps the value but
 * fails as one long string, and its key order counts. This rule flags those
 * shapes as the actual argument and names the whole-value form.
 *
 * When one field really is the whole contract, keep the check and add
 * `// eslint-disable-next-line agent-doctest/check-whole-value -- <why>`.
 */

import type { Rule } from "eslint";
import type { Expression, Node } from "estree";
import { checkMethod } from "./check-call.js";

const COMPARISONS = new Set(["===", "!==", "==", "!=", "<", "<=", ">", ">=", "instanceof", "in"]);
const PREDICATES = new Set(["includes", "has", "some", "every", "startsWith", "endsWith"]);

function memberName(node: Node): string | null {
  if (node.type !== "MemberExpression" || node.computed || node.property.type !== "Identifier") return null;
  return node.property.name;
}

/** True for a call like `JSON.stringify(...)`: `name` is `"JSON.stringify"`. */
function calleeIs(node: Node, name: string): boolean {
  if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") return false;
  const { object, property } = node.callee;
  return object.type === "Identifier" && property.type === "Identifier" && `${object.name}.${property.name}` === name;
}

/**
 * The expression under wrappers that do not change what it computes:
 * `x?.includes(y)` (a chain), `await x.has(y)`, and TypeScript's `x!` and
 * `x as T`, which reach ESLint as `TSNonNullExpression` and `TSAsExpression`.
 */
function unwrap(node: Node): Node {
  if (node.type === "ChainExpression" || node.type === "AwaitExpression") return unwrap(node.type === "ChainExpression" ? node.expression : node.argument);
  const ts = node as { type: string; expression?: Node };
  if ((ts.type === "TSNonNullExpression" || ts.type === "TSAsExpression") && ts.expression !== undefined) return unwrap(ts.expression);
  return node;
}

/** The message id for a lossy actual argument, or null when it is a whole value. */
function lossy(wrapped: Expression): string | null {
  const arg = unwrap(wrapped);
  if (arg.type === "BinaryExpression" && COMPARISONS.has(arg.operator)) return "comparison";
  if (arg.type === "UnaryExpression" && arg.operator === "!") return "boolean";
  // `a.includes(x) && a.includes(y)`: a boolean made from lossy parts.
  if (arg.type === "LogicalExpression" && (lossy(arg.left) !== null || lossy(arg.right) !== null)) return "boolean";
  if (arg.type === "CallExpression" && arg.callee.type === "Identifier" && arg.callee.name === "Boolean") return "boolean";
  if (calleeIs(arg, "JSON.stringify")) return "json";
  const member = memberName(arg);
  if (member === "length" || member === "size") return "size";
  if (arg.type === "CallExpression" && PREDICATES.has(memberName(arg.callee) ?? "")) return "predicate";
  return null;
}

const rule: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: { description: "Require t.check to compare whole values, not lengths, JSON strings, or booleans" },
    messages: {
      comparison: "Check the values, not a comparison: write `t.check(a, b)` instead of `t.check(a === b, true)`, or `t.check(a, is(b))` when `a` must be the same object as `b`.",
      boolean: "Check the value itself, not a boolean made from it.",
      json: "Check the value, not its JSON: `t.check(x, {...})` ignores key order and reports each differing path.",
      size: "Check the collection itself, not its size: a failure then shows which items differ.",
      predicate:
        "Check the whole value, not a true/false test of it: a failure then shows what the value is. For an array that holds an item among others, use `t.check(list, containing([item]))`.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (checkMethod(node) !== "check") return;
        const [actual] = node.arguments;
        if (actual === undefined || actual.type === "SpreadElement") return;
        const messageId = lossy(actual);
        if (messageId !== null) context.report({ node: actual, messageId });
      },
    };
  },
};

export default rule;

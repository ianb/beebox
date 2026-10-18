/**
 * Tests assert with `t.check`, `t.checkText`, and `t.checkThrows`. tap's own
 * asserts (`t.equal`, `t.ok`, `t.same`, `t.match`, `t.throws`, ...) compare
 * one field at a time or loosely, and report a failure without the path that
 * differs. This rule flags them and names the check method to use.
 */

import type { Rule } from "eslint";
import type { CallExpression } from "estree";
import { TEST_OBJECTS } from "./check-call.js";

/** tap's value asserts, by the check that replaces each. `t.error`, `t.pass`, and `t.fail` stay. */
const REPLACEMENT: Readonly<Record<string, string>> = {
  equal: "check", not: "check", same: "check", notSame: "check", strictSame: "check", strictNotSame: "check",
  ok: "check", notOk: "check", match: "check", notMatch: "check", matchOnly: "check", matchStrict: "check",
  notMatchOnly: "check", notMatchStrict: "check", has: "check", notHas: "check", hasStrict: "check",
  notHasStrict: "check", hasProp: "check", hasProps: "check", hasOwnProp: "check", hasOwnProps: "check",
  hasOwnPropsOnly: "check", type: "check", resolveMatch: "check",
  throws: "checkThrows", rejects: "checkThrows",
};

function tapAssert(node: CallExpression): string | null {
  const { callee } = node;
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  if (callee.object.type !== "Identifier" || !TEST_OBJECTS.has(callee.object.name)) return null;
  if (callee.property.type !== "Identifier" || !Object.hasOwn(REPLACEMENT, callee.property.name)) return null;
  return callee.property.name;
}

const rule: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: { description: "Require t.check, t.checkText, or t.checkThrows instead of tap's own asserts" },
    messages: {
      tapAssert: "Use `t.{{replacement}}(actual, expected)` instead of `t.{{method}}`: it compares the whole value and reports each path that differs.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const method = tapAssert(node);
        if (method === null) return;
        context.report({ node: node.callee, messageId: "tapAssert", data: { method, replacement: REPLACEMENT[method] ?? "check" } });
      },
    };
  },
};

export default rule;

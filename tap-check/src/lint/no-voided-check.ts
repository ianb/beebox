/**
 * `void t.check(...)` silences `no-floating-promises` for a check whose
 * result is a promise: the test can end before the check reports, and a
 * failure is lost. Await the check instead.
 */

import type { Rule } from "eslint";
import { checkMethod } from "./check-call.js";

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow `void` in front of t.check, t.checkText, or t.checkThrows" },
    messages: {
      voided: "Do not `void` a {{method}} call: if it returns a promise, a failure is lost. Use `await t.{{method}}(...)`.",
    },
    schema: [],
  },
  create(context) {
    return {
      UnaryExpression(node) {
        if (node.operator !== "void") return;
        const method = checkMethod(node.argument);
        if (method !== null) context.report({ node, messageId: "voided", data: { method } });
      },
    };
  },
};

export default rule;

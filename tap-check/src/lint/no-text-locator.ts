/**
 * A DOM test that finds a control by its text, as in
 * `[...el.querySelectorAll("button")].find((b) => b.textContent === "Save")`,
 * breaks when the copy changes and passes when the control has no accessible
 * name. Find it by id, or by role and accessible name, instead.
 *
 * Flags a read of `textContent` or `innerText` inside the callback of an
 * array search (`find`, `filter`, `some`, ...). Reading the text to check it,
 * as in `t.check(el.textContent, "Saved")` or a `.map` of the texts, is not
 * flagged: there the copy is what the test checks. Locating through a helper
 * function that reads `textContent` outside such a callback is not caught.
 */

import type { Rule } from "eslint";
import type { ArrowFunctionExpression, FunctionExpression, Node } from "estree";

const SEARCHES = new Set(["find", "findLast", "findIndex", "findLastIndex", "filter", "some", "every"]);
const TEXT_PROPERTIES = new Set(["textContent", "innerText"]);

/** The array-search method whose callback this function is, or null. */
function searchMethod(fn: ArrowFunctionExpression | FunctionExpression, parent: Node | null): string | null {
  if (parent?.type !== "CallExpression" || !parent.arguments.includes(fn)) return null;
  const callee = parent.callee;
  if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return null;
  return SEARCHES.has(callee.property.name) ? callee.property.name : null;
}

const rule: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: { description: "Disallow finding a DOM element by its text content" },
    messages: {
      textLocator:
        "Do not find an element by its {{property}} in a .{{method}}() callback. Find it by id or by role and accessible name; check the text separately when the copy is under test.",
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (node.computed || node.property.type !== "Identifier" || !TEXT_PROPERTIES.has(node.property.name)) return;
        const ancestors = context.sourceCode.getAncestors(node);
        for (let i = ancestors.length - 1; i >= 0; i--) {
          const fn = ancestors[i];
          if (fn === undefined) return;
          if (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression") continue;
          const method = searchMethod(fn, ancestors[i - 1] ?? null);
          if (method !== null) context.report({ node, messageId: "textLocator", data: { property: node.property.name, method } });
          return;
        }
      },
    };
  },
};

export default rule;

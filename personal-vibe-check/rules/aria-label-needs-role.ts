/**
 * ESLint rule: `aria-label` on a generic element needs a `role`.
 *
 * `div`, `span`, `p`, `i` and `b` have no role of their own (generic or
 * paragraph), and browsers do not expose an accessible name on a generic
 * element, so a screen reader never reads the label. Give the element a role
 * that takes a name (`group` for a labelled cluster, `status` for a loading
 * placeholder, `img` for a drawn picture) or drop the label. Found by the
 * `accessible-names` guide in GoogleChrome/modern-web-guidance (Apache-2.0).
 *
 * Deliberately not reported:
 *   - an element with a spread attribute (`{...props}`), which may carry the
 *     role;
 *   - elements outside the list above, such as `section` or a component: the
 *     rule cannot see what a component renders.
 *
 * Limitations: it does not check that the chosen role accepts a name, and an
 * `aria-labelledby` without `aria-label` is not reported.
 */

import type { Rule } from "eslint";
import type * as ESTree from "estree";

const GENERIC_ELEMENTS = new Set(["div", "span", "p", "i", "b"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** JSX nodes are not in `estree`; this narrows to a node ESLint can report on. */
function isNode(value: unknown): value is ESTree.Node {
  return isRecord(value) && typeof value.type === "string";
}

/** JSX nodes come from the parser extension, outside `estree`; read their shape through guards. */
function attributeName(attr: unknown): string | null {
  if (!isRecord(attr) || attr.type !== "JSXAttribute") return null;
  const name = attr.name;
  return isRecord(name) && name.type === "JSXIdentifier" && typeof name.name === "string" ? name.name : null;
}

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require a role on generic elements (div, span, p, i, b) that carry aria-label",
    },
    schema: [],
    messages: {
      labelNeedsRole:
        'aria-label on <{{element}}> is ignored: a generic element has no accessible name. Add a role that takes a name (role="group", role="status", role="img") or remove the label.',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node: unknown) {
        if (!isNode(node) || !isRecord(node) || !isRecord(node.name) || node.name.type !== "JSXIdentifier") return;
        const element = node.name.name;
        if (typeof element !== "string" || !GENERIC_ELEMENTS.has(element)) return;
        const attrs: unknown = node.attributes;
        if (!Array.isArray(attrs)) return;
        let hasLabel = false;
        for (const attr of attrs) {
          if (isRecord(attr) && attr.type === "JSXSpreadAttribute") return;
          const name = attributeName(attr);
          if (name === "role") return;
          if (name === "aria-label") hasLabel = true;
        }
        if (hasLabel) context.report({ node, messageId: "labelNeedsRole", data: { element } });
      },
    };
  },
};

export default rule;

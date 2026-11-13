/**
 * ESLint rule: a dialog is a native `<dialog>`, not an element with
 * `role="dialog"`.
 *
 * A JSX element other than `dialog` with `role="dialog"` or
 * `role="alertdialog"` (a string literal) is reported. A native `<dialog>`
 * opened with `showModal()` gives focus trapping, Escape to close, a
 * top-layer backdrop and an inert page behind it for free; a non-modal
 * overlay can use a popover. A hand-built overlay has to make the page behind
 * it `inert` itself. Found by the dialog guides in GoogleChrome/modern-web-guidance
 * (Apache-2.0).
 *
 * Deliberately not reported:
 *   - an element with a spread attribute (`{...props}`), which may carry or
 *     replace the role;
 *   - a `role` that is not a string literal (`role={x}`, a template literal);
 *   - a `<dialog>` element itself, and components (the rule cannot see what
 *     they render).
 *
 * Limitations: a component that forwards a `role` prop to a div is not seen
 * by the rule, and the role token list is not split, so `role="dialog foo"` is
 * not reported.
 */

import type { Rule } from "eslint";
import type * as ESTree from "estree";

const DIALOG_ROLES = new Set(["dialog", "alertdialog"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** JSX nodes are not in `estree`; this narrows to a node ESLint can report on. */
function isNode(value: unknown): value is ESTree.Node {
  return isRecord(value) && typeof value.type === "string";
}

/** The string literal value of a `role` attribute, `undefined` when it is not a literal. */
function literalValue(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === "Literal") return typeof value.value === "string" ? value.value : undefined;
  if (value.type === "JSXExpressionContainer" && isRecord(value.expression)) {
    const expr = value.expression;
    if (expr.type === "Literal" && typeof expr.value === "string") return expr.value;
  }
  return undefined;
}

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: 'Prefer a native <dialog> over an element with role="dialog" or role="alertdialog"',
    },
    schema: [],
    messages: {
      preferDialog:
        'Use a native <dialog> opened with showModal() (modal) or a popover (non-modal) instead of role="{{role}}" on <{{element}}>. A custom overlay needs inert on the page behind it.',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node: unknown) {
        if (!isNode(node) || !isRecord(node) || !isRecord(node.name) || node.name.type !== "JSXIdentifier") return;
        const element = node.name.name;
        if (typeof element !== "string" || element === "dialog" || !/^[a-z]/.test(element)) return;
        const attrs: unknown = node.attributes;
        if (!Array.isArray(attrs)) return;
        let role: string | undefined;
        for (const attr of attrs) {
          if (!isRecord(attr)) continue;
          if (attr.type === "JSXSpreadAttribute") return;
          if (attr.type !== "JSXAttribute") continue;
          const name = attr.name;
          if (isRecord(name) && name.type === "JSXIdentifier" && name.name === "role") role = literalValue(attr.value);
        }
        if (role !== undefined && DIALOG_ROLES.has(role)) {
          context.report({ node, messageId: "preferDialog", data: { role, element } });
        }
      },
    };
  },
};

export default rule;

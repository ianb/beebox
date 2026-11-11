/**
 * ESLint rule: no Tailwind `h-screen`, `min-h-screen`, `max-h-screen` in
 * className strings.
 *
 * Those utilities are `100vh`, which on mobile Safari is the height with the
 * address bar hidden, so a page sized to it overshoots the visible area. Use
 * the dynamic-viewport forms (`h-dvh`, `min-h-dvh`, `max-h-dvh`). The
 * arbitrary spellings `h-[100vh]`, `min-h-[100vh]` and `max-h-[100vh]` are
 * reported too. From the `responsive-design` guide in
 * GoogleChrome/modern-web-guidance (Apache-2.0).
 *
 * Tailwind-specific, so it is not in the shared preset: a project that uses
 * Tailwind turns it on in its own config.
 *
 * Checks string literals and template literal text inside a `className`
 * attribute, including those nested in `cn(...)` calls and conditionals. Class
 * names built elsewhere (a const, another prop) are not checked.
 */

import type { Rule } from "eslint";
import type * as ESTree from "estree";

const BANNED = /^!?(?:min-|max-)?h-(?:screen|\[100vh])$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** JSX nodes are not in `estree`; this narrows to a node ESLint can report on. */
function isNode(value: unknown): value is ESTree.Node {
  return isRecord(value) && typeof value.type === "string";
}

/** Drop Tailwind variant prefixes (`md:`, `hover:`), keeping the utility. */
function utility(token: string): string {
  return token.slice(token.lastIndexOf(":") + 1);
}

function bannedIn(text: string): string | null {
  for (const token of text.split(/\s+/)) {
    const name = utility(token);
    if (BANNED.test(name)) return name.replace(/^!/, "");
  }
  return null;
}

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Ban Tailwind h-screen / min-h-screen / max-h-screen (100vh) in className strings",
    },
    schema: [],
    messages: {
      viewportHeight:
        "`{{name}}` is 100vh, which overshoots on mobile Safari. Use the dynamic-viewport form (`{{name}}` -> `{{fix}}`).",
    },
  },
  create(context) {
    function report(node: ESTree.Node, text: string): void {
      const name = bannedIn(text);
      if (name === null) return;
      context.report({ node, messageId: "viewportHeight", data: { name, fix: name.replace(/screen|\[100vh]/, "dvh") } });
    }

    function visit(node: unknown): void {
      if (!isNode(node)) return;
      if (node.type === "Literal" && typeof node.value === "string") report(node, node.value);
      else if (node.type === "TemplateElement" && typeof node.value.cooked === "string")
        report(node, node.value.cooked);
      for (const [key, value] of Object.entries(node)) {
        if (key === "parent") continue;
        if (Array.isArray(value)) for (const child of value) visit(child);
        else visit(value);
      }
    }

    return {
      JSXAttribute(node: unknown) {
        if (!isRecord(node) || !isRecord(node.name) || node.name.name !== "className") return;
        visit(node.value);
      },
    };
  },
};

export default rule;

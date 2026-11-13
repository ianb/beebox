/**
 * ESLint rule: no Tailwind `text-[<n>px]` font sizes in className strings.
 *
 * A pixel font size ignores the browser's default font size, so a person who
 * raised it for readability gets no larger text. Write the same size in rem
 * (`text-[11px]` -> `text-[0.6875rem]`, which is px / 16 to at most four
 * decimals) or use a theme size. A `/leading` suffix (`text-[11px]/4`) is
 * reported too. From the `typography` guide in GoogleChrome/modern-web-guidance
 * (Apache-2.0).
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

const BANNED = /^!?text-\[(\d+(?:\.\d+)?)px](?:\/.+)?$/;

function remValue(px: string): string {
  return `${Number((Number(px) / 16).toFixed(4))}rem`;
}

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

function bannedIn(text: string): { name: string; fix: string } | null {
  for (const token of text.split(/\s+/)) {
    const name = utility(token);
    const match = BANNED.exec(name);
    if (match?.[1] !== undefined) return { name: name.replace(/^!/, ""), fix: `text-[${remValue(match[1])}]` };
  }
  return null;
}

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Ban Tailwind text-[<n>px] font sizes in className strings",
    },
    schema: [],
    messages: {
      pxFontSize:
        "`{{name}}` is a pixel font size, which ignores the browser's default font size. Use rem (px / 16): `{{fix}}`.",
    },
  },
  create(context) {
    function report(node: ESTree.Node, text: string): void {
      const found = bannedIn(text);
      if (found === null) return;
      context.report({ node, messageId: "pxFontSize", data: found });
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

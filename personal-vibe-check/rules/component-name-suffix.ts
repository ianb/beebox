/**
 * ESLint rule: ban configured suffixes on component names.
 *
 * A project with shared UI primitives settles one word per overlay kind
 * (`Dialog` for a `ModalDialog`, `Popover`, `Menu`, `Screen`). A component
 * named `ThingModal` or `ThingPopup` reads as a second kind of overlay, so the
 * next author goes looking for a `Modal` primitive that does not exist, or
 * writes one. The rule makes the names collide at lint time; it does not
 * check what the component renders (the element, role, class and import
 * guards do that).
 *
 * Checked: a function declaration, or a `const` whose value is a function
 * expression, an arrow function, or a `memo(...)`/`forwardRef(...)` call
 * (also as `React.memo`), whose name starts with an upper-case letter and
 * ends with a banned suffix. Not checked: classes, default-exported anonymous
 * functions, and components built any other way.
 */

import type { Rule } from "eslint";
import { fileOwner } from "./lib/allow-in.ts";

interface Options {
  banned: Record<string, string>;
  allowIn: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The schema has validated the shape; this re-checks it so the types follow without a cast. */
function readOptions(raw: unknown): Options {
  const options = isRecord(raw) ? raw : {};
  const banned = isRecord(options.banned)
    ? Object.fromEntries(Object.entries(options.banned).filter((pair): pair is [string, string] => typeof pair[1] === "string"))
    : {};
  const allowIn = Array.isArray(options.allowIn) ? options.allowIn.filter((glob) => typeof glob === "string") : [];
  return { banned, allowIn };
}

const WRAPPERS = new Set(["memo", "forwardRef"]);

/** Whether `node` is a function, or a `memo`/`forwardRef` call, that can define a component. */
function definesComponent(node: unknown): boolean {
  if (!isRecord(node)) return false;
  if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") return true;
  if (node.type !== "CallExpression") return false;
  const callee = node.callee;
  if (!isRecord(callee)) return false;
  if (callee.type === "Identifier") return typeof callee.name === "string" && WRAPPERS.has(callee.name);
  const property = callee.type === "MemberExpression" ? callee.property : null;
  return isRecord(property) && property.type === "Identifier" && typeof property.name === "string" && WRAPPERS.has(property.name);
}

function identifierName(node: unknown): string | null {
  return isRecord(node) && node.type === "Identifier" && typeof node.name === "string" ? node.name : null;
}

const rule: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: { description: "Ban configured suffixes on component names" },
    schema: [
      {
        type: "object",
        properties: {
          banned: { type: "object", additionalProperties: { type: "string" } },
          allowIn: { type: "array", items: { type: "string" } },
        },
        required: ["banned"],
        additionalProperties: false,
      },
    ],
    messages: {
      suffix: "`{{name}}` ends in `{{suffix}}`: {{message}}",
    },
  },
  create(context) {
    const options = readOptions(context.options[0]);
    if (fileOwner(context)(options.allowIn)) return {};
    const check = (node: Rule.Node, name: string | null): void => {
      if (name === null || !/^[A-Z]/.test(name)) return;
      for (const [suffix, message] of Object.entries(options.banned)) {
        if (name.endsWith(suffix)) context.report({ node, messageId: "suffix", data: { name, suffix, message } });
      }
    };
    return {
      FunctionDeclaration(node: Rule.Node) {
        if (node.type === "FunctionDeclaration") check(node, identifierName(node.id));
      },
      VariableDeclarator(node: Rule.Node) {
        if (node.type === "VariableDeclarator" && definesComponent(node.init)) check(node, identifierName(node.id));
      },
    };
  },
};

export default rule;

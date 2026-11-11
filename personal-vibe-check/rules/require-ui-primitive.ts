/**
 * ESLint rule: ban configured intrinsic elements, ARIA roles and attributes,
 * outside the files that own them.
 *
 * A project with shared UI primitives wants one owner per control: a raw
 * `<input>` outside the field primitives skips their label, error and ink
 * contract, and `control-has-associated-label` does not see inputs at all.
 * Each entry names what is banned, the files that own it (`allowIn`) and the
 * message that points at the primitive. It is the element-and-attribute
 * counterpart of `restricted-classes`, with the same per-entry `allowIn`.
 *
 * Checked:
 *   - `elements`: a JSX element whose name is the configured lower-case tag.
 *   - `roles`: a `role` attribute on any JSX element whose value is a string
 *     literal, a template literal with no expressions, or a conditional whose
 *     branches are such strings. Each space-separated token is checked.
 *   - `attributes`: a JSX attribute with the configured name on any element,
 *     whatever its value.
 *
 * Not checked: components (the rule cannot see what they render), a `role` or
 * attribute supplied by a spread (`{...props}`), a `role` held in an
 * identifier, and `React.createElement` calls.
 */

import type { Rule } from "eslint";
import { fileOwner } from "./lib/allow-in.ts";

interface Entry {
  message: string;
  allowIn?: string[];
}

type EntryMap = Record<string, Entry>;

interface Options {
  elements: EntryMap;
  roles: EntryMap;
  attributes: EntryMap;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEntry(value: unknown): value is Entry {
  return (
    isRecord(value) &&
    typeof value.message === "string" &&
    (value.allowIn === undefined ||
      (Array.isArray(value.allowIn) && value.allowIn.every((glob) => typeof glob === "string")))
  );
}

function entryMap(value: unknown): EntryMap {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((pair): pair is [string, Entry] => isEntry(pair[1])));
}

/** The schema has validated the shape; this re-checks it so the types follow without a cast. */
function readOptions(raw: unknown): Options {
  const options = isRecord(raw) ? raw : {};
  return {
    elements: entryMap(options.elements),
    roles: entryMap(options.roles),
    attributes: entryMap(options.attributes),
  };
}

/** The string values a `role` can take, or none when one of them is not static. */
function staticStrings(node: unknown): string[] {
  if (!isRecord(node)) return [];
  if (node.type === "Literal") return typeof node.value === "string" ? [node.value] : [];
  if (node.type === "JSXExpressionContainer") return staticStrings(node.expression);
  if (node.type === "TemplateLiteral") {
    const quasis = node.quasis;
    if (!Array.isArray(quasis) || quasis.length !== 1 || !isRecord(quasis[0])) return [];
    const value = quasis[0].value;
    return isRecord(value) && typeof value.cooked === "string" ? [value.cooked] : [];
  }
  if (node.type === "ConditionalExpression")
    return [...staticStrings(node.consequent), ...staticStrings(node.alternate)];
  return [];
}

/** The name of a JSX identifier node (`input`, `aria-haspopup`), or null for any other name. */
function identifierName(node: unknown): string | null {
  return isRecord(node) && node.type === "JSXIdentifier" && typeof node.name === "string" ? node.name : null;
}

const ENTRY_MAP = {
  type: "object",
  additionalProperties: {
    type: "object",
    properties: {
      message: { type: "string" },
      allowIn: { type: "array", items: { type: "string" } },
    },
    required: ["message"],
    additionalProperties: false,
  },
};

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Ban configured elements, ARIA roles and attributes outside the files that own them",
    },
    schema: [
      {
        type: "object",
        properties: { elements: ENTRY_MAP, roles: ENTRY_MAP, attributes: ENTRY_MAP },
        additionalProperties: false,
      },
    ],
    messages: {
      element: "`<{{name}}>`: {{message}}",
      role: '`role="{{name}}"`: {{message}}',
      attribute: "`{{name}}`: {{message}}",
    },
  },
  create(context) {
    const options = readOptions(context.options[0]);
    const owns = fileOwner(context);
    const banned = (map: EntryMap, name: string): Entry | null => {
      const entry = Object.hasOwn(map, name) ? map[name] : undefined;
      return entry === undefined || owns(entry.allowIn) ? null : entry;
    };

    return {
      JSXOpeningElement(node: Rule.Node) {
        if (!isRecord(node)) return;
        const name = identifierName(node.name);
        if (name === null || !/^[a-z]/.test(name)) return;
        const entry = banned(options.elements, name);
        if (entry !== null) context.report({ node, messageId: "element", data: { name, message: entry.message } });
      },
      JSXAttribute(node: Rule.Node) {
        if (!isRecord(node)) return;
        const name = identifierName(node.name);
        if (name === null) return;
        const attribute = banned(options.attributes, name);
        if (attribute !== null)
          context.report({ node, messageId: "attribute", data: { name, message: attribute.message } });
        if (name !== "role") return;
        const tokens = new Set(staticStrings(node.value).flatMap((value) => value.split(/\s+/)));
        for (const role of tokens) {
          const entry = role === "" ? null : banned(options.roles, role);
          if (entry !== null) context.report({ node, messageId: "role", data: { name: role, message: entry.message } });
        }
      },
    };
  },
};

export default rule;

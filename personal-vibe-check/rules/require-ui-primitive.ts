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
 *   - `elements`: a JSX element whose name is the configured lower-case tag,
 *     or a component-cased name that is a local `const` bound to such a string
 *     (`const Input = "input"; <Input />`); a `createElement` call from
 *     "react" (also an import alias, or `React.createElement`) whose first
 *     argument is such a string.
 *   - `roles`: a `role` attribute on any JSX element, or a `role` property of
 *     a `createElement` props object, whose value is a string literal, a
 *     template literal with no expressions, a local `const` bound to one, or a
 *     conditional whose branches are such strings. Each space-separated token
 *     is checked.
 *   - `attributes`: a JSX attribute with the configured name on any element,
 *     whatever its value.
 *   - The same attributes and roles inside a literal object spread
 *     (`{...{ role: "menu" }}`) and in a `createElement` props object.
 *
 * Not checked: components (the rule cannot see what they render), a `role` or
 * attribute supplied by a spread of a non-literal (`{...props}`), and values
 * the rule cannot resolve statically (parameters, imports, computed keys).
 */

import type { Rule, Scope, SourceCode } from "eslint";
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

function isNode(value: unknown): value is Rule.Node {
  return isRecord(value) && typeof value.type === "string";
}

/** The name of a JSX identifier node (`input`, `aria-haspopup`), or null for any other name. */
function identifierName(node: unknown): string | null {
  return isRecord(node) && node.type === "JSXIdentifier" && typeof node.name === "string" ? node.name : null;
}

/** The name a property key spells (`role`, `"aria-haspopup"`), or null for a computed or other key. */
function propertyName(property: Record<string, unknown>): string | null {
  const key = property.key;
  if (!isRecord(key) || property.computed === true) return null;
  if (key.type === "Identifier" && typeof key.name === "string") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

const MAX_DEPTH = 8;

/** Where a name is looked up: the node whose scope applies. */
interface Site {
  sourceCode: SourceCode;
  at: Rule.Node;
}

/** The `const` declarator's initializer, or the import declaration, that binds `name` at the site. */
function binding({ sourceCode, at }: Site, name: string) {
  for (let scope: Scope.Scope | null = sourceCode.getScope(at); scope !== null; scope = scope.upper) {
    const variable = scope.set.get(name);
    if (variable === undefined) continue;
    const def = variable.defs[0];
    if (def === undefined) return null;
    if (def.type === "Variable" && isRecord(def.parent) && def.parent.kind === "const" && isRecord(def.node))
      return { init: def.node.init, source: null, imported: null };
    if (def.type === "ImportBinding" && isRecord(def.parent) && isRecord(def.parent.source)) {
      const specifier = def.node;
      const imported =
        isRecord(specifier) && specifier.type === "ImportSpecifier" && isRecord(specifier.imported)
          ? specifier.imported.name
          : null;
      return {
        init: null,
        source: def.parent.source.value,
        imported: typeof imported === "string" ? imported : null,
      };
    }
    return null;
  }
  return null;
}

/** The string values `node` can take, or none when one of them is not static. */
function staticStrings(site: Site, start: unknown): string[] {
  const walk = (node: unknown, depth: number): string[] => {
    if (!isRecord(node) || depth > MAX_DEPTH) return [];
    const next = (inner: unknown) => walk(inner, depth + 1);
    if (node.type === "Literal") return typeof node.value === "string" ? [node.value] : [];
    if (node.type === "JSXExpressionContainer") return next(node.expression);
    if (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") return next(node.expression);
    if (node.type === "TemplateLiteral") {
      const quasis = node.quasis;
      if (!Array.isArray(quasis) || quasis.length !== 1 || !isRecord(quasis[0])) return [];
      const value = quasis[0].value;
      return isRecord(value) && typeof value.cooked === "string" ? [value.cooked] : [];
    }
    if (node.type === "ConditionalExpression") return [...next(node.consequent), ...next(node.alternate)];
    if (node.type === "Identifier" && typeof node.name === "string") {
      const bound = binding(site, node.name);
      return bound === null ? [] : next(bound.init);
    }
    return [];
  };
  return walk(start, 0);
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

    const sourceCode = context.sourceCode;

    const reportElement = (node: Rule.Node, name: string) => {
      const entry = banned(options.elements, name);
      if (entry !== null) context.report({ node, messageId: "element", data: { name, message: entry.message } });
    };

    /** Check one attribute (JSX attribute or object property) by name and value. */
    const checkAttribute = (report: Rule.Node, { name, value }: { name: string; value: unknown }) => {
      const attribute = banned(options.attributes, name);
      if (attribute !== null)
        context.report({
          node: report,
          messageId: "attribute",
          data: { name, message: attribute.message },
        });
      if (name !== "role") return;
      const tokens = new Set(staticStrings({ sourceCode, at: report }, value).flatMap((text) => text.split(/\s+/)));
      for (const role of tokens) {
        const entry = role === "" ? null : banned(options.roles, role);
        if (entry !== null)
          context.report({
            node: report,
            messageId: "role",
            data: { name: role, message: entry.message },
          });
      }
    };

    /** Check the properties of a literal props object (a spread or a createElement argument). */
    const checkObject = (object: unknown) => {
      if (!isRecord(object) || object.type !== "ObjectExpression" || !Array.isArray(object.properties)) return;
      for (const property of object.properties) {
        if (!isRecord(property)) continue;
        if (property.type === "SpreadElement") {
          checkObject(property.argument);
          continue;
        }
        if (property.type !== "Property") continue;
        const name = propertyName(property);
        if (name !== null && isNode(property)) checkAttribute(property, { name, value: property.value });
      }
    };

    /** Whether a call's callee is `createElement` imported from "react", under any alias or namespace. */
    const isCreateElement = (call: Rule.Node, callee: unknown): boolean => {
      if (!isRecord(callee)) return false;
      if (callee.type === "Identifier" && typeof callee.name === "string") {
        const bound = binding({ sourceCode, at: call }, callee.name);
        return bound !== null && bound.source === "react" && bound.imported === "createElement";
      }
      if (
        callee.type === "MemberExpression" &&
        callee.computed !== true &&
        isRecord(callee.property) &&
        callee.property.name === "createElement" &&
        isRecord(callee.object) &&
        callee.object.type === "Identifier" &&
        typeof callee.object.name === "string"
      ) {
        const bound = binding({ sourceCode, at: call }, callee.object.name);
        return bound !== null && bound.source === "react";
      }
      return false;
    };

    return {
      JSXOpeningElement(node: Rule.Node) {
        if (!isRecord(node)) return;
        const name = identifierName(node.name);
        if (name === null) return;
        if (/^[a-z]/.test(name)) reportElement(node, name);
        else
          for (const tag of new Set(staticStrings({ sourceCode, at: node }, { type: "Identifier", name })))
            reportElement(node, tag);
      },
      JSXAttribute(node: Rule.Node) {
        if (!isRecord(node)) return;
        const name = identifierName(node.name);
        if (name !== null) checkAttribute(node, { name, value: node.value });
      },
      JSXSpreadAttribute(node: Rule.Node) {
        if (isRecord(node)) checkObject(node.argument);
      },
      CallExpression(node: Rule.Node) {
        if (!isRecord(node) || !isCreateElement(node, node.callee) || !Array.isArray(node.arguments)) return;
        const [tag, props] = node.arguments;
        for (const name of new Set(staticStrings({ sourceCode, at: node }, tag))) reportElement(node, name);
        checkObject(props);
      },
    };
  },
};

export default rule;

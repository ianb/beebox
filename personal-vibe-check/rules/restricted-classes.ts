/**
 * ESLint rule: ban configured class patterns or combinations, outside the
 * files that own them.
 *
 * A project with shared UI primitives wants one owner per visual shape: one
 * spinner, one anchored panel, one focus ring. A copy of the shape elsewhere
 * is a class string, so a class-level ban with a per-entry owner list stops
 * the next copy at lint time. Each entry names the shape (`all`), what makes
 * it acceptable (`none`, for example a replacement focus style), the owning
 * files (`allowIn`) and the message that points at the primitive.
 *
 * Optionally it bans inline `style={{ position: "fixed" }}` the same way
 * (`stylePosition`), since a style object sidesteps a class ban.
 *
 * Reading and matching are in `lib/class-matcher.ts`. Not checked: class
 * strings held in an identifier or member expression (`className={classes}`),
 * a combination split across two independent conditional operands, and
 * `twMerge` overrides (`cn("fixed", "static")` is reported). A class string in
 * a prop other than `className` is read only through a class helper call.
 */

import type { Rule } from "eslint";
import path from "node:path";
import {
  type ClassEntryPatterns,
  calleeName,
  DEFAULT_CALLEES,
  findMatch,
  parsePattern,
  readClassValue,
} from "./lib/class-matcher.ts";

interface EntryOption {
  all: string[];
  none?: string[];
  allowIn?: string[];
  message: string;
}

interface StylePositionOption {
  values: string[];
  allowIn?: string[];
  message: string;
}

interface Options {
  entries: EntryOption[];
  callees?: string[];
  stylePosition?: StylePositionOption;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isEntry(value: unknown): value is EntryOption {
  return (
    isRecord(value) &&
    isStringArray(value.all) &&
    typeof value.message === "string" &&
    (value.none === undefined || isStringArray(value.none)) &&
    (value.allowIn === undefined || isStringArray(value.allowIn))
  );
}

function isStylePosition(value: unknown): value is StylePositionOption {
  return (
    isRecord(value) &&
    isStringArray(value.values) &&
    typeof value.message === "string" &&
    (value.allowIn === undefined || isStringArray(value.allowIn))
  );
}

/** The schema has validated the shape; this re-checks it so the types follow without a cast. */
function readOptions(raw: unknown): Options {
  if (!isRecord(raw) || !Array.isArray(raw.entries) || !raw.entries.every(isEntry))
    return { entries: [] };
  return {
    entries: raw.entries,
    callees: isStringArray(raw.callees) ? raw.callees : undefined,
    stylePosition: isStylePosition(raw.stylePosition) ? raw.stylePosition : undefined,
  };
}

const STRING_ARRAY = { type: "array", items: { type: "string" } };

/** A JSX attribute's name, when the node is one. JSX nodes are not in `estree`. */
function attributeName(node: unknown): string | null {
  if (!isRecord(node) || node.type !== "JSXAttribute" || !isRecord(node.name)) return null;
  return typeof node.name.name === "string" ? node.name.name : null;
}

function propertyKey(node: Record<string, unknown>): string | null {
  const key = node.key;
  if (node.computed === true || !isRecord(key)) return null;
  if (key.type === "Identifier" && typeof key.name === "string") return key.name;
  return key.type === "Literal" && typeof key.value === "string" ? key.value : null;
}

/** String values a style property can take: a literal, or either branch of a conditional. */
function literalValues(node: unknown): string[] {
  if (!isRecord(node)) return [];
  if (node.type === "Literal" && typeof node.value === "string") return [node.value];
  if (node.type === "ConditionalExpression")
    return [...literalValues(node.consequent), ...literalValues(node.alternate)];
  return [];
}

interface CompiledEntry extends ClassEntryPatterns {
  allowIn: string[];
  message: string;
}

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Ban configured class patterns or combinations outside the files that own them",
    },
    schema: [
      {
        type: "object",
        properties: {
          entries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                all: { ...STRING_ARRAY, minItems: 1 },
                none: STRING_ARRAY,
                allowIn: STRING_ARRAY,
                message: { type: "string" },
              },
              required: ["all", "message"],
              additionalProperties: false,
            },
          },
          callees: STRING_ARRAY,
          stylePosition: {
            type: "object",
            properties: {
              values: { ...STRING_ARRAY, minItems: 1 },
              allowIn: STRING_ARRAY,
              message: { type: "string" },
            },
            required: ["values", "message"],
            additionalProperties: false,
          },
        },
        required: ["entries"],
        additionalProperties: false,
      },
    ],
    messages: {
      restrictedClasses: "`{{classes}}`: {{message}}",
      restrictedPosition: '`position: "{{value}}"`: {{message}}',
    },
  },
  create(context) {
    const options = readOptions(context.options[0]);
    const callees = new Set(options.callees ?? DEFAULT_CALLEES);
    // `allowIn` globs are relative to ESLint's working directory, which is the
    // config's directory when ESLint runs there. From elsewhere they match
    // nothing, so the rule fails closed.
    const file = path.relative(context.cwd, context.filename).split(path.sep).join("/");
    const owns = (globs: string[] | undefined): boolean =>
      (globs ?? []).some((glob) => path.matchesGlob(file, glob));
    const entries: CompiledEntry[] = options.entries
      .filter((entry) => !owns(entry.allowIn))
      .map((entry) => ({
        all: entry.all.map(parsePattern),
        none: (entry.none ?? []).map(parsePattern),
        allowIn: entry.allowIn ?? [],
        message: entry.message,
      }));
    const stylePosition =
      options.stylePosition !== undefined && !owns(options.stylePosition.allowIn)
        ? options.stylePosition
        : undefined;

    function check(node: Rule.Node, value: unknown): void {
      const classValue = readClassValue(value, callees);
      for (const entry of entries) {
        const matched = findMatch(classValue, entry);
        if (matched === null) continue;
        context.report({
          node,
          messageId: "restrictedClasses",
          data: { classes: matched.join(" "), message: entry.message },
        });
      }
    }

    function checkStyle(node: Rule.Node, value: unknown): void {
      if (
        stylePosition === undefined ||
        !isRecord(value) ||
        value.type !== "JSXExpressionContainer"
      )
        return;
      const object = value.expression;
      if (
        !isRecord(object) ||
        object.type !== "ObjectExpression" ||
        !Array.isArray(object.properties)
      )
        return;
      for (const property of object.properties) {
        if (
          !isRecord(property) ||
          property.type !== "Property" ||
          propertyKey(property) !== "position"
        )
          continue;
        for (const literal of literalValues(property.value)) {
          if (!stylePosition.values.includes(literal)) continue;
          context.report({
            node,
            messageId: "restrictedPosition",
            data: { value: literal, message: stylePosition.message },
          });
        }
      }
    }

    /** A helper call already read as part of a `className` value or an enclosing helper call. */
    function readByAncestor(node: Rule.Node): boolean {
      return context.sourceCode.getAncestors(node).some((ancestor) => {
        if (attributeName(ancestor) === "className") return true;
        const name = calleeName(ancestor);
        return name !== null && callees.has(name);
      });
    }

    return {
      JSXAttribute(node: Rule.Node) {
        if (!isRecord(node)) return;
        const name = attributeName(node);
        if (name === "className") check(node, node.value);
        else if (name === "style") checkStyle(node, node.value);
      },
      CallExpression(node) {
        const name = calleeName(node);
        if (name === null || !callees.has(name) || readByAncestor(node)) return;
        check(node, node);
      },
    };
  },
};

export default rule;

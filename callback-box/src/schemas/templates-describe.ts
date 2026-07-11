/**
 * Human-readable description of a template's argument schema. Inspects the Zod
 * shape to render each argument with its optionality, array-ness, description,
 * and default value.
 */

import { z } from "zod";
import { getTemplate } from "./templates-registry.js";

/**
 * Check if a Zod schema is an array type (possibly wrapped in optional/default).
 */
function isArraySchema(schema: z.ZodTypeAny): boolean {
  if (schema instanceof z.ZodArray) return true;
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    // eslint-disable-next-line no-restricted-syntax -- zod's public `unwrap()` returns the core `$ZodType`; bridge to the classic `ZodTypeAny` these instanceof-based helpers use (same core/classic boundary as the loop below)
    return isArraySchema(schema.unwrap() as z.ZodTypeAny);
  }
  return false;
}

/**
 * Extract default value from a Zod schema if it has one.
 */
function getDefaultValue(schema: z.ZodTypeAny): unknown {
  if (schema instanceof z.ZodDefault) {
    const dv = schema._def.defaultValue;
    // eslint-disable-next-line no-restricted-syntax -- zod 4 types the raw default as a value-or-thunk with no public getter; narrow the thunk arm to call it (display-only)
    return typeof dv === "function" ? (dv as () => unknown)() : dv;
  }
  return undefined;
}

/**
 * Render a single argument line for the describe output.
 */
function describeArgLine(key: string, zodSchema: z.ZodTypeAny): string {
  const description = zodSchema.description ?? "";
  const defaultVal = getDefaultValue(zodSchema);

  let line = `  ${key}`;
  if (isArraySchema(zodSchema)) {
    line += " (array — repeat key or use JSON: key='[\"a\",\"b\"]')";
  }
  if (zodSchema.isOptional()) {
    line += " (optional)";
  }
  if (description) {
    line += `: ${description}`;
  }
  if (defaultVal !== undefined) {
    line += ` [default: ${JSON.stringify(defaultVal)}]`;
  }
  return line;
}

/**
 * Describe a template's arguments in human-readable format.
 */
export function describeTemplateArgs(name: string): string {
  const template = getTemplate(name);
  if (!template) {
    return `Unknown template: ${name}`;
  }

  const shape = template.argsSchema.shape;
  const lines: string[] = [
    `Template: ${template.name}`,
    `Description: ${template.description}`,
    `Card types: ${template.cardTypes.join(", ")}`,
    "",
    "Arguments:",
  ];

  for (const [key, schema] of Object.entries(shape)) {
    // eslint-disable-next-line no-restricted-syntax -- ZodObject.shape is typed with zod's core `$ZodType`; bridging to the classic `ZodTypeAny` the describe helpers use (instanceof-narrow classic subclasses) needs this one boundary cast
    lines.push(describeArgLine(key, schema as z.ZodTypeAny));
  }

  return lines.join("\n");
}

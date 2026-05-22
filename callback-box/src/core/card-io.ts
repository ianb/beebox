/**
 * Card file IO for the markdown-frontmatter card format (Phase 2).
 *
 * A `.card` file is a frontmatter-prefixed text file:
 *
 *   ---
 *   type: doc
 *   drive-id: 1abc...
 *   title: Project Notes
 *   ...
 *   ---
 *   markdown body, if the schema declares one
 *
 * The host application (this module) owns YAML parsing so cardworks
 * stays YAML-free. cardworks provides the schema declaration primitives
 * (`cardSchema`, `body`) and the frontmatter splitter (`splitCardContent`).
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  splitCardContent,
  type CardSchema,
} from "cardworks";

const CARD_XML_CONTENT_TYPE = "application/x-card+xml";

/**
 * Errors raised by the card IO layer. Caller code can catch this specifically
 * to distinguish format-level problems from arbitrary IO errors.
 */
export class CardIOError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardIOError";
  }
}

/**
 * A parsed card. `fields` is the validated, typed object — the union of
 * frontmatter fields and (if the schema declares one) the body field, keyed
 * uniformly by field name.
 */
export interface ParsedCard<TFields extends Record<string, unknown> = Record<string, unknown>> {
  schema: CardSchema;
  fields: TFields;
  /** Body text exactly as it appeared in the file (empty string if none). */
  rawBody: string;
  /** Optional content-type from frontmatter; undefined for markdown/empty bodies. */
  contentType: string | undefined;
}

/**
 * Parse a `.card` file's raw text against a registered schema.
 *
 * Looks up the schema in `schemas` by the frontmatter's `type:` field.
 */
export function parseCardText(
  content: string,
  { source, schemas }: { source: string; schemas: Map<string, CardSchema> }
): ParsedCard {
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) {
    throw new CardIOError(`${source}: missing frontmatter block`);
  }

  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(split.frontmatterText);
  } catch (e) {
    const err = e as Error;
    throw new CardIOError(`${source}: invalid YAML frontmatter: ${err.message}`);
  }
  if (frontmatter === null || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    throw new CardIOError(`${source}: frontmatter must be a YAML mapping`);
  }
  const fm = frontmatter as Record<string, unknown>;

  const type = fm["type"];
  if (typeof type !== "string") {
    throw new CardIOError(`${source}: frontmatter is missing required \`type\` field`);
  }
  const schema = schemas.get(type);
  if (schema === undefined) {
    throw new CardIOError(`${source}: no schema registered for type "${type}"`);
  }

  const fmParse = schema.frontmatterSchema.safeParse(fm);
  if (!fmParse.success) {
    throw new CardIOError(
      `${source}: frontmatter validation failed for type "${type}": ${fmParse.error.message}`
    );
  }
  const fmFields = fmParse.data as Record<string, unknown>;

  const contentType = typeof fm["content-type"] === "string" ? fm["content-type"] : undefined;

  let bodyValue: unknown;
  if (schema.bodyField !== null && schema.bodyFieldName !== null) {
    if (schema.bodyField.kind === "markdown") {
      bodyValue = split.body;
    } else if (schema.bodyField.kind === "xml") {
      bodyValue = split.body;
      if (contentType !== CARD_XML_CONTENT_TYPE) {
        throw new CardIOError(
          `${source}: schema "${type}" expects an XML body but content-type is ${contentType === undefined ? "missing" : `"${contentType}"`}`
        );
      }
    }
    const bodyParse = schema.bodyField.schema.safeParse(bodyValue);
    if (!bodyParse.success) {
      throw new CardIOError(
        `${source}: body validation failed for type "${type}": ${bodyParse.error.message}`
      );
    }
    bodyValue = bodyParse.data;
  } else {
    if (split.body.trim().length > 0) {
      throw new CardIOError(`${source}: schema "${type}" declares no body, but file has body content`);
    }
  }

  const fields: Record<string, unknown> = { ...fmFields };
  if (schema.bodyFieldName !== null) {
    fields[schema.bodyFieldName] = bodyValue;
  }

  return {
    schema,
    fields,
    rawBody: split.body,
    contentType,
  };
}

/**
 * Serialize a parsed card back to its file representation.
 *
 * Splits the input fields object into frontmatter (everything but the body
 * field) + body, sets the appropriate content-type, and emits a fenced YAML
 * block followed by the body text.
 */
export function serializeCardText(input: {
  schema: CardSchema;
  fields: Record<string, unknown>;
}): string {
  const { schema, fields } = input;
  const frontmatter: Record<string, unknown> = { type: schema.type };
  let body = "";
  for (const [name, value] of Object.entries(fields)) {
    if (name === "type") continue;
    if (schema.bodyFieldName === name) {
      if (schema.bodyField === null) continue;
      if (schema.bodyField.kind === "markdown") {
        body = typeof value === "string" ? value : String(value);
      } else if (schema.bodyField.kind === "xml") {
        body = typeof value === "string" ? value : String(value);
        frontmatter["content-type"] = CARD_XML_CONTENT_TYPE;
      }
      continue;
    }
    if (value === undefined) continue;
    frontmatter[name] = value;
  }
  const yamlText = stringifyYaml(frontmatter);
  // YAML.stringify ends with \n already
  return `---\n${yamlText}---\n${body}`;
}

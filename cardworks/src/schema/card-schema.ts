import { z, type ZodType } from "zod";

/**
 * Card schemas describe a card file's full shape: most fields live in the
 * YAML frontmatter, and at most one field lives in the file body.
 *
 * cardworks itself does not parse YAML — the host application reads the
 * frontmatter into a plain object and hands it to a CardSchema for
 * validation. CardSchema declarations are also where templates,
 * documentation, and migration tooling look up per-field metadata.
 */

const BODY_FIELD_TAG = Symbol("cardworks.bodyField");

/**
 * Supported body content kinds. Markdown bodies are plain UTF-8 text;
 * XML bodies are validated against an XML element schema (the body
 * itself is the element — there is no synthetic root wrapper).
 */
export type BodyKind = "markdown" | "xml";

export interface BodyFieldOptions {
  /** Body kind. Defaults to "markdown". */
  kind?: BodyKind;
}

export interface BodyField<TSchema extends ZodType = ZodType> {
  readonly [BODY_FIELD_TAG]: true;
  readonly schema: TSchema;
  readonly kind: BodyKind;
}

/**
 * Marks a field as living in the card's file body instead of the YAML
 * frontmatter. Each CardSchema may declare at most one body field.
 */
export function body<TSchema extends ZodType>(
  schema: TSchema,
  options: BodyFieldOptions = {}
): BodyField<TSchema> {
  const kind = options.kind === undefined ? "markdown" : options.kind;
  return { [BODY_FIELD_TAG]: true, schema, kind };
}

export function isBodyField(value: unknown): value is BodyField {
  return (
    typeof value === "object"
    && value !== null
    && BODY_FIELD_TAG in value
  );
}

/**
 * A field declaration: either a Zod schema (frontmatter) or a body()-wrapped
 * Zod schema (file body).
 */
export type FieldDecl = ZodType | BodyField;

/**
 * Configuration for cardSchema().
 */
export interface CardSchemaConfig<TFields extends Record<string, FieldDecl>> {
  /** All fields keyed by name. At most one may be body()-wrapped. */
  fields: TFields;
  /** Handling instructions for agents working with this card type. */
  instructions?: string;
}

/**
 * Resolved shape of a card schema. Used by loaders, serializers, and migration
 * tooling to know what lives where.
 */
export interface CardSchema<
  TTag extends string = string,
  TFields extends Record<string, FieldDecl> = Record<string, FieldDecl>,
> {
  readonly type: TTag;
  readonly fields: TFields;
  /** Name of the single body field, or null if the card is frontmatter-only. */
  readonly bodyFieldName: string | null;
  /** Resolved body field (kind + schema), or null. */
  readonly bodyField: BodyField | null;
  /** Zod schema for the frontmatter object (everything except the body field, plus `type`). */
  readonly frontmatterSchema: ZodType;
  /** Handling instructions for agents. */
  readonly instructions?: string;
}

/**
 * Declare a card schema. The result tells the loader/serializer which
 * fields are frontmatter and which is the body.
 *
 * Card files identify their schema via a top-level `type:` field in the
 * YAML frontmatter; that field is added automatically to the frontmatter
 * schema and need not be listed under `fields`.
 */
export function cardSchema<
  TTag extends string,
  TFields extends Record<string, FieldDecl>,
>(type: TTag, config: CardSchemaConfig<TFields>): CardSchema<TTag, TFields> {
  let bodyFieldName: string | null = null;
  let bodyField: BodyField | null = null;
  const frontmatterShape: Record<string, ZodType> = {
    type: z.literal(type),
  };
  for (const [name, decl] of Object.entries(config.fields)) {
    if (isBodyField(decl)) {
      if (bodyFieldName !== null) {
        throw new Error(
          `cardSchema(${type}): multiple body fields not supported (${bodyFieldName}, ${name})`
        );
      }
      bodyFieldName = name;
      bodyField = decl;
    } else {
      frontmatterShape[name] = decl;
    }
  }
  if (bodyField === null && Object.keys(config.fields).length === 0) {
    throw new Error(`cardSchema(${type}): must declare at least one field`);
  }
  const schema: CardSchema<TTag, TFields> = {
    type,
    fields: config.fields,
    bodyFieldName,
    bodyField,
    frontmatterSchema: z.object(frontmatterShape),
  };
  if (config.instructions !== undefined) {
    return { ...schema, instructions: config.instructions };
  }
  return schema;
}

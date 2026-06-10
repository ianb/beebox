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
 * Thrown when a cardSchema() declaration is invalid (multiple body fields,
 * or no fields at all). Carries the offending card type for inspection.
 */
class CardSchemaDeclarationError extends Error {
  readonly type: string;
  constructor(type: string, detail: string) {
    super(`cardSchema(${type}): ${detail}`);
    this.name = "CardSchemaDeclarationError";
    this.type = type;
  }
}

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
  options?: BodyFieldOptions
): BodyField<TSchema> {
  options = options ?? {};
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
 * Optional frontmatter fields available on every card type, injected into
 * the frontmatter schema by cardSchema() unless the schema declares its own
 * field of the same name (the schema's declaration wins — e.g. a card type
 * may require `title` rather than leave it optional).
 *
 * - `title` — human-readable display title.
 * - `contains` — one sentence stating what can be found inside this card;
 *   the prime retrieval field for search and listings.
 */
export const GLOBAL_CARD_FIELDS: Record<string, ZodType> = {
  title: z.string().optional(),
  contains: z.string().optional(),
};

/**
 * Configuration for cardSchema().
 */
export interface CardSchemaConfig<TFields extends Record<string, FieldDecl>> {
  /** All fields keyed by name. At most one may be body()-wrapped. */
  fields: TFields;
  /** Handling instructions for agents working with this card type. */
  instructions?: string;
  /**
   * Whether cards of this type belong in content search indexes.
   * Defaults to true; operational/bookkeeping card types set false.
   */
  searchable?: boolean;
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
  /** Names from GLOBAL_CARD_FIELDS injected here (i.e. not author-declared). */
  readonly globalFieldNames: ReadonlyArray<string>;
  /** Whether cards of this type belong in content search indexes. */
  readonly searchable: boolean;
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
        throw new CardSchemaDeclarationError(
          type,
          `multiple body fields not supported (${bodyFieldName}, ${name})`
        );
      }
      bodyFieldName = name;
      bodyField = decl;
    } else {
      frontmatterShape[name] = decl;
    }
  }
  if (bodyField === null && Object.keys(config.fields).length === 0) {
    throw new CardSchemaDeclarationError(type, "must declare at least one field");
  }
  const globalFieldNames: string[] = [];
  for (const [name, validator] of Object.entries(GLOBAL_CARD_FIELDS)) {
    if (name in config.fields) continue; // schema-wins: author declaration takes precedence
    frontmatterShape[name] = validator;
    globalFieldNames.push(name);
  }
  const schema: CardSchema<TTag, TFields> = {
    type,
    fields: config.fields,
    bodyFieldName,
    bodyField,
    frontmatterSchema: z.object(frontmatterShape),
    globalFieldNames,
    searchable: config.searchable ?? true,
  };
  if (config.instructions !== undefined) {
    return { ...schema, instructions: config.instructions };
  }
  return schema;
}

/**
 * Walk a parsed fields object and pull out every reference.
 *
 * Refs are identified by convention, not by schema declaration:
 *   - any key literally named `ref` whose value is a string
 *   - any key literally named `refs` whose value is an array of strings
 *
 * Refs can appear at any depth — inside nested objects, inside array
 * elements, etc. Each result carries a JSON path (with indices filled
 * in) so callers can attach lint errors to a specific position.
 */
export function extractRefs(
  fields: Record<string, unknown>
): Array<{ path: string; ref: string }> {
  const out: Array<{ path: string; ref: string }> = [];
  walkForRefs(fields, { currentPath: "", out });
  return out;
}

interface WalkForRefsOptions {
  currentPath: string;
  out: Array<{ path: string; ref: string }>;
}

function walkForRefs(value: unknown, { currentPath, out }: WalkForRefsOptions): void {
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      walkForRefs(item, { currentPath: `${currentPath}[${String(i)}]`, out });
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = currentPath === "" ? key : `${currentPath}.${key}`;
    if (key === "ref" && typeof child === "string") {
      out.push({ path: childPath, ref: child });
      continue;
    }
    if (key === "refs" && Array.isArray(child)) {
      const items = child as unknown[];
      for (const [i, item] of items.entries()) {
        if (typeof item === "string") {
          out.push({ path: `${childPath}[${String(i)}]`, ref: item });
        }
      }
      continue;
    }
    walkForRefs(child, { currentPath: childPath, out });
  }
}

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
 * The card-primitive layer (`src/cards/`) provides the schema declaration
 * primitives (`cardSchema`, `body`) and the frontmatter splitter
 * (`splitCardContent`); this module owns the YAML parsing on top of them.
 */

import { readFile } from "node:fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { splitCardContent, type CardSchema } from "../cards/index.js";

const CARD_XML_CONTENT_TYPE = "application/x-card+xml";

/**
 * Errors raised by the card IO layer. Caller code can catch this specifically
 * to distinguish format-level problems from arbitrary IO errors.
 */
export class CardIOError extends Error {
  readonly source: string;
  readonly detail: string;
  constructor(source: string, detail: string) {
    super(`${source}: ${detail}`);
    this.name = "CardIOError";
    this.source = source;
    this.detail = detail;
  }
}

interface ZodIssueLike {
  path: ReadonlyArray<string | number | symbol>;
  message: string;
  code?: string;
  expected?: string;
  received?: string;
}

/**
 * Render Zod issues as a compact, one-line-per-issue list:
 *
 *   - status: invalid option (expected "new"|"processing"|"processed")
 *   - boxholder.relationships[0].text: required
 *
 * Replaces the multi-line JSON dump Zod's `.message` produces.
 */
function formatZodIssues(issues: ReadonlyArray<ZodIssueLike>): string {
  return issues
    .map((issue) => {
      const pathStr =
        issue.path.length === 0
          ? "(root)"
          : issue.path
              .map((seg, i) => {
                if (typeof seg === "number") return `[${String(seg)}]`;
                return i === 0 ? String(seg) : `.${String(seg)}`;
              })
              .join("");
      return `  - ${pathStr}: ${shortenIssueMessage(issue)}`;
    })
    .join("\n");
}

function shortenIssueMessage(issue: ZodIssueLike): string {
  const m = issue.message;
  // Zod's stock "Invalid input: expected <X>, received <Y>" → "expected X, got Y"
  const expectedReceived = m.match(/^Invalid input: expected (.+?), received (.+)$/);
  if (expectedReceived) {
    if (expectedReceived[2] === "undefined") return `required (expected ${expectedReceived[1]})`;
    return `expected ${expectedReceived[1]}, got ${expectedReceived[2]}`;
  }
  return m;
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
 * The card's type is taken from the filename (`Foo.<type>.card`), not from a
 * `type:` field in the frontmatter — the filename is the canonical
 * discriminator. If the YAML happens to carry a `type:` field, it must
 * either match the filename type or be absent; mismatches are a lint
 * error. Either way, the field is normalized into the parsed fields
 * object (so consumers can still read `fields.type`).
 */
export function parseCardText(
  content: string,
  { source, schemas, type }: { source: string; schemas: Map<string, CardSchema>; type?: string }
): ParsedCard {
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) {
    throw new CardIOError(source, "missing frontmatter block");
  }

  const fm = parseFrontmatterMapping(split.frontmatterText, source);

  const resolved = resolveCardType({ fm, source, type });
  const schema = schemas.get(resolved);
  if (schema === undefined) {
    throw new CardIOError(source, `no schema registered for type "${resolved}"`);
  }

  // cardworks bakes `type: z.literal(...)` into frontmatterSchema, so we
  // inject the resolved type before validation. The on-disk YAML is no
  // longer required to carry it.
  const fmForValidation = { ...fm, type: resolved };
  const fmParse = schema.frontmatterSchema.safeParse(fmForValidation);
  if (!fmParse.success) {
    throw new CardIOError(
      source,
      `invalid ${resolved} frontmatter:\n${formatZodIssues(fmParse.error.issues)}`
    );
  }
  const fmFields = fmParse.data as Record<string, unknown>;

  const contentType = typeof fm["content-type"] === "string" ? fm["content-type"] : undefined;

  const bodyValue = validateCardBody({ schema, body: split.body, contentType, resolved, source });

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
 * Parse the frontmatter YAML block into a plain mapping. An empty block
 * (which YAML parses as `null`) becomes an empty mapping; non-mapping YAML
 * (arrays, scalars) is a format error.
 */
function parseFrontmatterMapping(frontmatterText: string, source: string): Record<string, unknown> {
  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(frontmatterText);
  } catch (e) {
    const err = e as Error;
    throw new CardIOError(source, `invalid YAML frontmatter: ${err.message}`);
  }
  // YAML parses an empty block as `null`; treat that as an empty mapping
  // so cards whose only frontmatter field got stripped still parse.
  if (Array.isArray(frontmatter) || (frontmatter !== null && typeof frontmatter !== "object")) {
    throw new CardIOError(source, "frontmatter must be a YAML mapping");
  }
  return (frontmatter as Record<string, unknown> | null) ?? {};
}

/**
 * Resolve the card type: caller-supplied wins, otherwise derive from the
 * source filename (Foo.<type>.card), otherwise fall back to any `type:`
 * field in the YAML for callers that haven't been updated yet. A YAML
 * `type:` that contradicts a caller-supplied `type` is a format error.
 */
function resolveCardType(input: {
  fm: Record<string, unknown>;
  source: string;
  type: string | undefined;
}): string {
  const { fm, source, type } = input;
  const yamlType = typeof fm["type"] === "string" ? (fm["type"] as string) : undefined;
  const resolved = type ?? typeFromFilename(source) ?? yamlType;
  if (resolved === undefined) {
    throw new CardIOError(
      source,
      "cannot determine card type — filename must match Foo.<type>.card"
    );
  }
  if (type !== undefined && yamlType !== undefined && yamlType !== type) {
    throw new CardIOError(
      source,
      `frontmatter type "${yamlType}" does not match filename type "${type}"`
    );
  }
  return resolved;
}

/**
 * Validate the body text against the schema's body field (if any) and
 * return the parsed body value. Schemas without a body field reject any
 * non-whitespace body content. Returns undefined when no body field exists.
 */
function validateCardBody(input: {
  schema: CardSchema;
  body: string;
  contentType: string | undefined;
  resolved: string;
  source: string;
}): unknown {
  const { schema, body, contentType, resolved, source } = input;
  if (schema.bodyField === null || schema.bodyFieldName === null) {
    if (body.trim().length > 0) {
      throw new CardIOError(source, `schema "${resolved}" declares no body, but file has body content`);
    }
    return undefined;
  }
  if (schema.bodyField.kind === "xml" && contentType !== CARD_XML_CONTENT_TYPE) {
    throw new CardIOError(
      source,
      `schema "${resolved}" expects an XML body but content-type is ${contentType === undefined ? "missing" : `"${contentType}"`}`
    );
  }
  const bodyParse = schema.bodyField.schema.safeParse(body);
  if (!bodyParse.success) {
    throw new CardIOError(
      source,
      `invalid ${resolved} body:\n${formatZodIssues(bodyParse.error.issues)}`
    );
  }
  return bodyParse.data;
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
  // No `type:` field emitted — the filename is the canonical discriminator.
  const frontmatter: Record<string, unknown> = {};
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

/**
 * A card loaded via the dispatcher. Every card is markdown-frontmatter now;
 * the type alias is kept for the many consumers that name it.
 */
export type LoadedCard = FrontmatterLoadedCard;

export interface FrontmatterLoadedCard {
  readonly kind: "frontmatter";
  readonly path: string;
  readonly schema: CardSchema;
  readonly fields: Record<string, unknown>;
  readonly contentType: string | undefined;
}

export interface LoadCardContext {
  /** Schemas keyed by frontmatter `type:` value. */
  cardSchemas: Map<string, CardSchema>;
}

/**
 * Load a `.card` file. The file must have a `---` frontmatter block whose
 * filename type (`Foo.<type>.card`) matches a registered CardSchema; anything
 * else throws a CardIOError.
 */
export async function loadCardFile(
  absPath: string,
  ctx: LoadCardContext
): Promise<LoadedCard> {
  const content = await readFile(absPath, "utf8");
  return loadCardFromText({ content, source: absPath, ctx });
}

/**
 * In-memory variant of loadCardFile. Useful for tests and for callers
 * that already have the file content in hand.
 */
export function loadCardFromText(input: {
  content: string;
  source: string;
  ctx: LoadCardContext;
}): Promise<LoadedCard> {
  const { content, source, ctx } = input;
  const split = splitCardContent(content);
  if (split.hasFrontmatter) {
    const fileType = typeFromFilename(source);
    if (fileType !== undefined && ctx.cardSchemas.has(fileType)) {
      const parsed = parseCardText(content, { source, schemas: ctx.cardSchemas, type: fileType });
      return Promise.resolve<LoadedCard>({
        kind: "frontmatter",
        path: source,
        schema: parsed.schema,
        fields: parsed.fields,
        contentType: parsed.contentType,
      });
    }
  }
  return Promise.reject(
    new CardIOError(source, "not a recognized card: no frontmatter block with a registered type")
  );
}

/**
 * Extract the card type from a filename matching `Foo.<type>.card`.
 * Job cards use the dotted convention `Foo.<kind>.job.card` (the reactor
 * discovers jobs by that suffix — see reactor/job-discovery.ts) while
 * their schemas are registered under hyphenated names, so e.g.
 * `Foo.intake.job.card` resolves to type `intake-job`.
 * Returns undefined when the source doesn't fit either pattern (e.g.
 * test fixtures with non-card paths).
 */
export function typeFromFilename(source: string): string | undefined {
  const base = source.split("/").pop() ?? source;
  const jobMatch = base.match(/^.+\.([^.]+)\.job\.card$/);
  if (jobMatch) return `${jobMatch[1]}-job`;
  const match = base.match(/^.+\.([^.]+)\.card$/);
  return match ? match[1] : undefined;
}



import { z, type ZodType } from "zod";
import type { LintIssue } from "./lint-format.js";
import { isRecord } from "../lib/is-record.js";
import { TodosFieldSchema, type TodoEntry } from "../shared/todo-model.js";
import { CardSymbol, type CardSymbolData } from "../shared/card-symbol.js";
import { Prominence, type ProminenceLevel, type EffectiveLevel } from "../shared/prominence.js";
import { ThemeChoiceSchema, validateThemeChoice, type ThemeChoice } from "../shared/card-theme.js";

/**
 * Card schemas describe a card file's full shape: most fields live in the
 * YAML frontmatter, and at most one field lives in the file body.
 *
 * The host (`core/card-io.ts`) reads the frontmatter into a plain object and
 * hands it to a CardSchema for validation. CardSchema declarations are also
 * where templates, documentation, and migration tooling look up per-field
 * metadata.
 *
 * (Absorbed from the former `cardworks` package — see
 * docs/implemented-plans/remove-cardworks-package.md.)
 */

const BODY_FIELD_TAG = Symbol("beebox.bodyField");

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

export interface BodyField<TSchema extends ZodType = ZodType> {
  readonly [BODY_FIELD_TAG]: true;
  readonly schema: TSchema;
}

/**
 * Marks a field as living in the card's file body instead of the YAML
 * frontmatter. Each CardSchema may declare at most one body field. Bodies are
 * markdown (plain UTF-8 text); if a non-markdown body encoding is ever needed
 * again, reintroduce a `kind` discriminator here (and its `content-type`
 * marker).
 */
export function body<TSchema extends ZodType>(
  schema: TSchema
): BodyField<TSchema> {
  return { [BODY_FIELD_TAG]: true, schema };
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
 * - `contains-evidence` — the accumulated detail `contains` was derived from,
 *   so a one-sentence summary can show its work. NOT a second summary and not
 *   scratch space: it is what someone (or something) read in order to write
 *   `contains`. Unlike `contains` it is uncapped, not embedded, and not
 *   searched — see core/search/query.ts. Most cards never set it.
 * - `todos` — a list of todo entries for intentions that don't belong to any
 *   particular sentence of the body (see `src/shared/todo-model.ts`, the
 *   frontmatter counterpart to the `{% todo %}` Markdoc tag).
 * - `symbol` — the small mark that stands for this card in a tab strip, a
 *   listing, or a tile: `{ glyph, src, foreground, background }`. Most cards
 *   have none; a box where everything is marked has nothing marked. See
 *   `src/shared/card-symbol.ts`.
 * - `prominence` — who a card is for, and whether the box should surface it
 *   to a reader looking around: `entry-point`, `primary`, or `background`.
 *   Absent (most cards) means the card type's default level — see
 *   `defaultProminence` below. See `src/shared/prominence.ts`.
 * - `theme` — an optional presentation choice. Catalog membership is checked
 *   by the host because a self-contained Zod schema cannot read box settings.
 *
 * Adding/removing a field here? Update the enumerations in
 * `.claude/skills/bbx-guide-schemas/SKILL.md` and `docs/adding-schemas.md`.
 */
export const GLOBAL_CARD_FIELDS: Record<string, ZodType> = {
  title: z.string().optional(),
  contains: z.string().optional(),
  "contains-evidence": z.string().optional(),
  todos: TodosFieldSchema,
  symbol: CardSymbol.optional(),
  prominence: Prominence.optional(),
  theme: ThemeChoiceSchema.optional(),
};

/**
 * Input to a schema's self-contained {@link CardSchemaConfig.validate} hook:
 * the card's own parsed data and nothing else (no loader / box / cross-card
 * access). `fields` is the Zod-validated frontmatter, with the body value at
 * `fields["body"]` when the schema declares a body field.
 *
 * This is an object (not a bare `fields` argument) so future self-contained
 * inputs can be added without breaking existing hooks. Box-aware validation
 * (ref resolution, looking at other cards) is deliberately not expressible
 * here — that belongs to a separate, host-side mechanism (card-lint.ts).
 */
export interface CardValidateInput {
  fields: Record<string, unknown>;
}

/**
 * Who creates cards of a type — drives how the agent guide groups the
 * card-type catalogue:
 * - `authored` — agents (and users via the UI) create and edit these; the
 *   working vocabulary. Box-local schemas default here.
 * - `synced` — created by connectors or capture; agents read and edit them
 *   but rarely create one by hand.
 * - `system` — created and consumed by the machinery (jobs, run records);
 *   agents don't author these.
 */
export type CardCategory = "authored" | "synced" | "system";

/**
 * Policy for reconciling a box's edited copy of a *template* card (a
 * procedure/guide/schedule/etc. that beebox ships and updates) with a
 * newer upstream version. The default behaviour, with no policy, is strict:
 * ANY divergence between the box's copy and the last-shipped stock parks the
 * update in `config/_template-updates/` for the boxholder to review, so an
 * edit is never silently overwritten.
 *
 * A policy loosens that for fields the box legitimately OWNS as per-box state
 * rather than template definition — the canonical case being a schedule's
 * `enabled` toggle. It is deliberately declarative (a field list, not a free
 * `merge(box, upstream)` function) because the judgement that actually matters
 * — "is this box on unmodified old stock, or did the boxholder edit the
 * definition?" — depends on the last-shipped hash, which lives in the version
 * tracker, not in the two card texts. A free callback couldn't see that and so
 * would have to either clobber real edits or freeze old stock. Declaring which
 * keys are state lets the tracker keep making that call correctly: it strips
 * the owned keys before comparing, so a box that differs ONLY in them still
 * reads as unmodified stock and takes the update, with its own values for those
 * keys carried onto the new version. Divergence in any other key or the body
 * still parks.
 */
export interface TemplateMergePolicy {
  /**
   * Frontmatter keys the box owns (its state, not the template's definition).
   * A box copy differing from upstream only in these keys is updated in place
   * with the box's values for them preserved; divergence outside them parks.
   */
  readonly boxOwnedFields: readonly string[];
}

/**
 * Configuration for cardSchema().
 */
export interface CardSchemaConfig<TFields extends Record<string, FieldDecl>> {
  /** All fields keyed by name. At most one may be body()-wrapped. */
  fields: TFields;
  /**
   * One line saying what a card of this type is / is for — shown in the agent
   * guide's card-type catalogue. Optional only so box-local schemas keep
   * loading without one; every built-in schema declares it.
   */
  description?: string;
  /** Who creates cards of this type (see {@link CardCategory}). Defaults to "authored". */
  category?: CardCategory;
  /**
   * This type's default `prominence` level, applied when a card of this type
   * leaves the field absent. Omit for the ordinary default; `category:
   * "system"` implies `"background"` unless this is set to something else.
   * A card's own `prominence:` always wins over the type default — see
   * `effectiveLevel()` in `src/shared/prominence.ts`.
   */
  prominence?: ProminenceLevel;
  /** This card type's preferred presentation when no card/rule/type override wins. */
  theme?: ThemeChoice;
  /** Handling instructions for agents working with this card type. */
  instructions?: string;
  /**
   * Whether cards of this type belong in content search indexes.
   * Defaults to true; operational/bookkeeping card types set false.
   */
  searchable?: boolean;
  /**
   * Self-contained validation a Zod schema can't express — cross-field rules,
   * body parsing, format refinements. Returns {@link LintIssue}[]. It sees only
   * the card's own data ({@link CardValidateInput}); generic, box-aware checks
   * (e.g. ref existence) stay in the host's lint dispatch rather than moving
   * per-schema. Omit when Zod `fields` cover the type.
   */
  validate?: (input: CardValidateInput) => LintIssue[];
  /**
   * Set when this schema's own {@link validate} hook already runs
   * `Markdoc.validate` on the card's body (e.g. commentary — see
   * `src/schemas/commentary.tsx`). The generic body-Markdoc pass in
   * `card-lint.ts` skips a card whose schema declares this, so the same
   * violation isn't reported twice (once at this schema's own severity,
   * once again as the generic warning). Omit for every other schema — the
   * generic pass is what gives them Markdoc validation at all.
   */
  ownMarkdocValidation?: boolean;
  /**
   * A parse-time cross-field refinement applied to the whole frontmatter object
   * (after `fields` + global fields are assembled). Unlike {@link validate}
   * (which runs at lint time and returns issues), this is enforced by
   * `frontmatterSchema.safeParse` itself, so a card that violates it fails to
   * LOAD — fail-closed for invariants that must never reach interior code
   * (e.g. a question whose `status` and lifecycle timestamps disagree). Runs on
   * the parsed object; add issues via the Zod refinement context.
   */
  superRefine?: (fields: Record<string, unknown>, ctx: z.core.$RefinementCtx) => void;
  /**
   * Reconciliation policy for template cards this schema covers (see
   * {@link TemplateMergePolicy}). Only meaningful for card types beebox
   * ships and updates as templates; omit it and any edit parks the update.
   */
  templateMerge?: TemplateMergePolicy;
  /**
   * Opt in to receiving submissions — a manifest plus files — into a
   * subdirectory of the card's attach scope through `POST /api/cards/submit`
   * and the shared submission form (see {@link CardSubmissions}). Omit for
   * every card type that does not act as an inbox.
   */
  submissions?: CardSubmissions;
}

/** One problem with a submission, addressed by a path the form can show. */
export interface SubmissionIssue {
  path: string;
  message: string;
}

export interface CardSubmissionInput {
  /** The card's parsed frontmatter fields. */
  fields: Record<string, unknown>;
  /** The parsed `records` part of the multipart body, whatever shape the schema expects. */
  manifest: unknown;
  /** Names of the file parts uploaded beside the manifest. */
  fileNames: readonly string[];
  /** Read a file from the card's attach scope by bare name; null when absent. */
  readAttachment: (name: string) => Promise<string | null>;
}

export type CardSubmissionResult = { ok: true; count: number } | { ok: false; issues: SubmissionIssue[] };

/**
 * A card type's submission contract. The route and the form are generic; the
 * schema owns what a valid batch is and when the card is accepting.
 */
export interface CardSubmissions {
  /** Subdirectory of the attach scope that receives batches, e.g. `inbox`. */
  dir: string;
  /** Null when the card accepts submissions; otherwise the reason it refuses (surfaced as 409). */
  refusal: (fields: Record<string, unknown>) => string | null;
  /**
   * Pure check over the manifest and file names. Runs in the browser before
   * upload (over `GET /api/files/*`) and on the server at the boundary (over
   * the filesystem); the `readAttachment` reader is what differs.
   */
  validate: (input: CardSubmissionInput) => Promise<CardSubmissionResult>;
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
  /** One-line catalogue description (see {@link CardSchemaConfig.description}). */
  readonly description?: string;
  /** Who creates cards of this type. Defaults to "authored". */
  readonly category: CardCategory;
  /**
   * This type's default `prominence` level for a card that leaves the field
   * absent (see {@link CardSchemaConfig.prominence}). Resolved at
   * declaration time: an explicit `prominence` option wins, otherwise
   * `category: "system"` yields `"background"`, otherwise `"ordinary"`.
   */
  readonly defaultProminence: EffectiveLevel;
  /** This type's optional theme preference; an explicit card choice still wins. */
  readonly defaultTheme?: ThemeChoice;
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
  /** Self-contained validation hook (see {@link CardSchemaConfig.validate}). */
  readonly validate?: (input: CardValidateInput) => LintIssue[];
  /** Whether this schema's own `validate` hook already runs Markdoc validation on the body (see {@link CardSchemaConfig.ownMarkdocValidation}). */
  readonly ownMarkdocValidation?: boolean;
  /** Template reconciliation policy (see {@link CardSchemaConfig.templateMerge}). */
  readonly templateMerge?: TemplateMergePolicy;
  /** Submission contract, when this card type acts as an inbox (see {@link CardSubmissions}). */
  readonly submissions?: CardSubmissions;
}

/**
 * The inferred value type of a single field declaration — the body-wrapped or
 * bare Zod schema's `z.infer`. Body fields carry their inner schema's type.
 */
type InferFieldDecl<D extends FieldDecl> = D extends BodyField<infer S>
  ? z.infer<S>
  : D extends ZodType
    ? z.infer<D>
    : never;

/**
 * Keys whose inferred type admits `undefined` become optional (`.optional()`
 * or an absent-friendly union); the rest are required. A `.default(...)` field
 * infers a non-`undefined` output type, so it lands in the required set — which
 * matches the parsed card, where the default has already been applied.
 */
type OptionalFieldKeys<TFields extends Record<string, FieldDecl>> = {
  [K in keyof TFields]: undefined extends InferFieldDecl<TFields[K]> ? K : never;
}[keyof TFields];

type RequiredFieldKeys<TFields extends Record<string, FieldDecl>> = Exclude<
  keyof TFields,
  OptionalFieldKeys<TFields>
>;

type InferFieldsRecord<TFields extends Record<string, FieldDecl>> = {
  [K in RequiredFieldKeys<TFields>]: InferFieldDecl<TFields[K]>;
} & {
  [K in OptionalFieldKeys<TFields>]?: InferFieldDecl<TFields[K]>;
};

/**
 * The validated shape of a parsed card's `fields` object, derived from the
 * schema itself: the injected `type` literal, the author-declared fields (with
 * body unwrapped and `.optional()`/`.default()` optionality honoured), and the
 * global fields ({@link GLOBAL_CARD_FIELDS}) that aren't already declared.
 *
 * This replaces the hand-written `XFields` interfaces that used to parallel
 * each schema — one declaration is now the single source of truth for both the
 * runtime validator and the compile-time type. Requires the schema constant to
 * keep its precise generics (declare it as `export const XSchema = cardSchema(...)`
 * WITHOUT a `: CardSchema` annotation, which would erase them).
 */
export type InferCardFields<S extends CardSchema> = S extends CardSchema<
  infer TTag,
  infer TFields
>
  ? { type: TTag }
    & InferFieldsRecord<TFields>
    & Omit<
      {
        title?: string;
        contains?: string;
        "contains-evidence"?: string;
        todos?: TodoEntry[];
        symbol?: CardSymbolData;
        prominence?: ProminenceLevel;
        theme?: ThemeChoice;
      },
      keyof TFields
    >
  : never;

/**
 * Declare a card schema. The result tells the loader/serializer which
 * fields are frontmatter and which is the body.
 *
 * Card files identify their schema via the filename (`Foo.<type>.card`); the
 * `type` literal is added automatically to the frontmatter schema and need
 * not be listed under `fields`.
 */
export function cardSchema<
  TTag extends string,
  TFields extends Record<string, FieldDecl>,
>(type: TTag, config: CardSchemaConfig<TFields>): CardSchema<TTag, TFields> {
  if (config.theme !== undefined) {
    const checkedTheme = validateThemeChoice(config.theme, `cardSchema(${type}) theme`);
    if (checkedTheme.problem !== null) {
      throw new CardSchemaDeclarationError(type, checkedTheme.problem.message);
    }
  }
  let bodyFieldName: string | null = null;
  let bodyField: BodyField | null = null;
  const frontmatterShape: Record<string, ZodType> = {
    type: z.literal(type),
  };
  for (const [name, decl] of Object.entries(config.fields)) {
    if (isBodyField(decl)) {
      if (name !== "body") {
        // One vocabulary across every card type: the file-body field is
        // always `body`. (On disk the body has no field name at all, so
        // this constrains code, not card files. It also makes multiple
        // body fields impossible — object keys are unique.)
        throw new CardSchemaDeclarationError(
          type,
          `the body field must be named "body" (got "${name}")`
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
  // Lenient (not `.strict()`): an unknown frontmatter key is stripped in
  // memory, so a card that has drifted past its schema still loads, renders,
  // and indexes — it lives in a usable middle-ground rather than vanishing.
  // The unknown key is surfaced separately as a lint *warning* (see
  // card-lint.ts) so it gets cleaned off disk eventually. A missing required
  // field or wrong type still fails here at parse — those are genuine
  // can't-use-this-card errors, not recoverable cruft.
  const baseFrontmatter = z.object(frontmatterShape);
  // A card-level `superRefine` keeps `frontmatterSchema` an object-typed schema
  // in zod 4 (checks attach to the object; `def.type`/`def.shape` survive), so
  // ref-walking and serialization still introspect it as an object.
  const frontmatterSchema: ZodType =
    config.superRefine !== undefined
      ? baseFrontmatter.superRefine(config.superRefine)
      : baseFrontmatter;
  const category: CardCategory = config.category === undefined ? "authored" : config.category;
  // A card the box writes for its own use is background by type — nothing to
  // declare per schema, the category is the declaration. An explicit
  // `prominence` option always wins (e.g. a system schema that wants to stay
  // ordinary would set it, though none currently do).
  const defaultProminence: EffectiveLevel =
    config.prominence ?? (category === "system" ? "background" : "ordinary");
  const schema: CardSchema<TTag, TFields> = {
    type,
    fields: config.fields,
    bodyFieldName,
    bodyField,
    frontmatterSchema,
    globalFieldNames,
    searchable: config.searchable === undefined ? true : config.searchable,
    category,
    defaultProminence,
  };
  // Optional members are spread in only when present so a schema that declares
  // neither still produces the same object shape (exactOptionalPropertyTypes).
  let resolved: CardSchema<TTag, TFields> = schema;
  if (config.description !== undefined) {
    resolved = { ...resolved, description: config.description };
  }
  if (config.theme !== undefined) {
    resolved = { ...resolved, defaultTheme: config.theme };
  }
  if (config.instructions !== undefined) {
    resolved = { ...resolved, instructions: config.instructions };
  }
  if (config.validate !== undefined) {
    resolved = { ...resolved, validate: config.validate };
  }
  if (config.ownMarkdocValidation !== undefined) {
    resolved = { ...resolved, ownMarkdocValidation: config.ownMarkdocValidation };
  }
  if (config.templateMerge !== undefined) {
    resolved = { ...resolved, templateMerge: config.templateMerge };
  }
  if (config.submissions !== undefined) {
    resolved = { ...resolved, submissions: config.submissions };
  }
  return resolved;
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
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = currentPath === "" ? key : `${currentPath}.${key}`;
    if (key === "ref" && typeof child === "string") {
      out.push({ path: childPath, ref: child });
      continue;
    }
    if (key === "refs" && Array.isArray(child)) {
      const items: unknown[] = child;
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

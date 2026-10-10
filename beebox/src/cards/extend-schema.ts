import type { LintIssue } from "./lint-format.js";
import type { ProminenceLevel } from "../shared/prominence.js";
import type { ThemeChoice } from "../shared/card-theme/core.js";
import type {
  CardFieldsOf,
  CardSchemaConfig,
  CardSummaryBase,
  CardSummaryParts,
  CardValidateInput,
  FieldDecl,
} from "./schema.js";

/**
 * Thrown when a delta redeclares a field the base already has. The type-level
 * rejection catches this under `tsc`; box schemas run under type stripping,
 * so the same rule holds at declaration time.
 */
export class RedeclaredFieldError extends Error {
  readonly field: string;
  constructor(field: string) {
    super(`extendSchema: delta redeclares base field "${field}"`);
    this.name = "RedeclaredFieldError";
    this.field = field;
  }
}

/**
 * What a box adds to an exported base (a `CardSchemaConfig` without a type
 * name) when it completes the base through `extendSchema`. It is typed on its
 * own, not as `Partial<base>`, so one added field does not restate the base's
 * fields, and the merged field type flows into `summarize` and
 * `InferCardFields`.
 *
 * `BF` is the base's field map; `DF` is the fields this delta adds.
 */
export interface SchemaDelta<
  BF extends Record<string, FieldDecl>,
  DF extends Record<string, FieldDecl>,
> {
  /** Added fields. A key the base already declares is a compile-time error. */
  readonly fields?: DF;
  /** Runs after the base's `validate`; both hooks' issues are reported. */
  readonly validate?: (input: CardValidateInput) => LintIssue[];
  /** Runs after the base's `superRefine`; a base invariant cannot be dropped. */
  readonly superRefine?: CardSchemaConfig<string, BF & DF>["superRefine"];
  /**
   * Receives the base's summary (its `summarize` applied first, or the engine
   * summary when the base has none) as `base`, over the merged fields.
   */
  readonly summarize?: (card: CardFieldsOf<string, BF & DF>, base: CardSummaryBase) => CardSummaryParts;
  /** Appended to the base's instructions, separated by a blank line. */
  readonly instructions?: string;
  readonly description?: string;
  readonly brief?: string;
  readonly prominence?: ProminenceLevel;
  readonly theme?: ThemeChoice;
}

/**
 * The field names a delta would redeclare. `extendSchema` requires this to be
 * `never`: an override that changed a field's type would invalidate the base's
 * callbacks, which were written against the base's types.
 */
type RedeclaredFieldKeys<
  BF extends Record<string, FieldDecl>,
  DF extends Record<string, FieldDecl>,
> = Extract<keyof BF, keyof DF>;

/**
 * Resolves to `unknown` (no extra constraint) when the delta adds only new
 * keys, and otherwise to an object type the delta literal cannot satisfy,
 * whose property name states the problem in the compiler's error message.
 */
type RejectRedeclaredFields<
  BF extends Record<string, FieldDecl>,
  DF extends Record<string, FieldDecl>,
> = [RedeclaredFieldKeys<BF, DF>] extends [never]
  ? unknown
  : { readonly "extendSchema: delta redeclares a base field": RedeclaredFieldKeys<BF, DF> };

/**
 * The merged field map. The two generic spreads intersect their types; an
 * absent delta adds no keys, which the type parameters already say (`DF`
 * defaults to `Record<never, FieldDecl>`), but TS cannot relate the `undefined`
 * branch to that default without help.
 */
function mergeFields<
  BF extends Record<string, FieldDecl>,
  DF extends Record<string, FieldDecl>,
>(base: BF, delta: DF | undefined): BF & DF {
  if (delta !== undefined) return { ...base, ...delta };
  // eslint-disable-next-line no-restricted-syntax -- no delta fields: the base map is the merged map; DF is the empty record here
  return base as BF & DF;
}

/**
 * A merged card seen through the base's field type. Sound because the delta
 * cannot redeclare a base field (rejected at the type level and at runtime),
 * so every base field keeps its declaration in the merged map; TS cannot
 * prove that across the two mapped types generically.
 */
function asBaseFields<
  BF extends Record<string, FieldDecl>,
  DF extends Record<string, FieldDecl>,
>(card: CardFieldsOf<string, BF & DF>): CardFieldsOf<string, BF> {
  // eslint-disable-next-line no-restricted-syntax -- the merged card is a superset of the base card; see the doc comment
  return card as CardFieldsOf<string, BF>;
}

function joinInstructions(base: string | undefined, delta: string | undefined): string | undefined {
  if (base === undefined) return delta;
  if (delta === undefined) return base;
  return `${base}\n\n${delta}`;
}

/**
 * Compose an exported base with a box's delta into the config `cardSchema`
 * takes: `cardSchema("progress", extendSchema(progressBase, { fields: { mood } }))`.
 *
 * Rules: `fields` merge by key, and a key present in both is a type error
 * (also thrown at runtime, since box code runs under type stripping);
 * `validate` runs base then delta and concatenates; `superRefine` runs both,
 * base first; `summarize` runs the delta with the base's result as `base`;
 * `instructions` concatenate with a blank line; `description`, `brief`,
 * `prominence`, and `theme` are delta-wins. Everything else is carried from
 * the base unchanged.
 */
export function extendSchema<
  BF extends Record<string, FieldDecl>,
  DF extends Record<string, FieldDecl> = Record<never, FieldDecl>,
>(
  base: CardSchemaConfig<string, BF>,
  delta: SchemaDelta<BF, DF> & RejectRedeclaredFields<BF, DF>,
): CardSchemaConfig<string, BF & DF> {
  for (const name of Object.keys(delta.fields ?? {})) {
    if (name in base.fields) {
      throw new RedeclaredFieldError(name);
    }
  }
  const { summarize: baseSummarize, fields: baseFields, ...carried } = base;
  const deltaSummarize = delta.summarize;
  const baseRefine = base.superRefine;
  const deltaRefine = delta.superRefine;
  const baseValidate = base.validate;
  const deltaValidate = delta.validate;
  const instructions = joinInstructions(base.instructions, delta.instructions);

  // `carried` holds every base member this function does not recompose. The
  // base's `summarize` is typed over the base fields, so it is re-added below
  // through `asBaseFields` rather than spread as-is.
  let merged: CardSchemaConfig<string, BF & DF> = {
    ...carried,
    fields: mergeFields(baseFields, delta.fields),
  };
  // Optional members are set only when present (exactOptionalPropertyTypes).
  if (instructions !== undefined) merged = { ...merged, instructions };
  if (delta.description !== undefined) merged = { ...merged, description: delta.description };
  if (delta.brief !== undefined) merged = { ...merged, brief: delta.brief };
  if (delta.prominence !== undefined) merged = { ...merged, prominence: delta.prominence };
  if (delta.theme !== undefined) merged = { ...merged, theme: delta.theme };
  if (deltaValidate !== undefined) {
    merged = {
      ...merged,
      validate: baseValidate === undefined
        ? deltaValidate
        : (input) => [...baseValidate(input), ...deltaValidate(input)],
    };
  }
  if (deltaRefine !== undefined) {
    merged = {
      ...merged,
      superRefine: baseRefine === undefined
        ? deltaRefine
        : (fields, ctx) => {
          baseRefine(fields, ctx);
          deltaRefine(fields, ctx);
        },
    };
  }
  if (deltaSummarize !== undefined) {
    merged = {
      ...merged,
      summarize: baseSummarize === undefined
        ? deltaSummarize
        : (card, summaryBase) => deltaSummarize(card, baseSummarize(asBaseFields<BF, DF>(card), summaryBase)),
    };
  } else if (baseSummarize !== undefined) {
    merged = { ...merged, summarize: (card, summaryBase) => baseSummarize(asBaseFields<BF, DF>(card), summaryBase) };
  }
  return merged;
}

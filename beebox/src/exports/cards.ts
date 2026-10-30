/**
 * Card primitive layer — the frontmatter-schema building blocks beebox
 * uses to declare and parse `.card` files. Absorbed from the former
 * `cardworks` package (see docs/implemented-plans/remove-cardworks-package.md).
 *
 * Box-local schemas (`src/schemas/*.ts`) import these via the public
 * `beebox/cards` specifier; internal code imports from `../cards/`.
 */

export {
  cardSchema,
  body,
  isBodyField,
  GLOBAL_CARD_FIELDS,
  type BodyField,
  type FieldDecl,
  type CardSchemaConfig,
  type CardSchema,
  type CardSummaryBase,
  type CardSummaryParts,
  type SummaryAttrs,
  type InferCardFields,
  type CardCategory,
  type CardValidateInput,
  type TemplateMergePolicy,
  type CardSubmissions,
  type CardSubmissionInput,
  type CardSubmissionResult,
  type SubmissionIssue,
} from "../cards/schema.js";
export { extendSchema, RedeclaredFieldError, RedeclaredTagError, type SchemaDelta } from "../cards/extend-schema.js";
export { definePlugin, type LintContext, type PluginDefinition } from "../cards/plugin-definition.js";
export { LabeledSourcesEntrySchema } from "../cards/sources-entry.js";
export type { TemplateDefinition } from "../templates-shape.js";
export { extractRefs } from "../cards/extract-refs.js";

export {
  cardRef,
  opaqueContentRef,
  collectInlineRefs,
} from "../cards/ref-fields.js";

export {
  splitCardContent,
  renderFrontmatterBlock,
  renderFrontmatterDocument,
  editableFrontmatterDocument,
  parseFrontmatterObject,
  type SplitCardContent,
} from "../cards/frontmatter.js";

export {
  formatLintResults,
  countBrokenRefs,
  countNonCanonicalRefs,
  type LintIssue,
  type LintResult,
  type LintSummary,
} from "../cards/lint-format.js";

export { ParseError } from "../cards/errors.js";

export {
  DateEntrySchema,
  IsoDateValueSchema,
  type DateEntry,
} from "../cards/date-entry.js";

/**
 * Card primitive layer — the frontmatter-schema building blocks callback-box
 * uses to declare and parse `.card` files. Absorbed from the former
 * `cardworks` package (see docs/implemented-plans/remove-cardworks-package.md).
 *
 * Box-local schemas (`config/schemas/*.ts`) import these via the public
 * `callback-box/cards` specifier; internal code imports from `../cards/`.
 */

export {
  cardSchema,
  body,
  extractRefs,
  isBodyField,
  GLOBAL_CARD_FIELDS,
  type BodyField,
  type FieldDecl,
  type CardSchemaConfig,
  type CardSchema,
  type InferCardFields,
  type CardCategory,
  type CardValidateInput,
  type TemplateMergePolicy,
} from "./schema.js";

export {
  cardRef,
  opaqueContentRef,
  collectInlineRefs,
} from "./ref-fields.js";

export {
  splitCardContent,
  renderFrontmatterBlock,
  parseFrontmatterObject,
  type SplitCardContent,
} from "./frontmatter.js";

export {
  formatLintResults,
  countBrokenRefs,
  type LintIssue,
  type LintResult,
  type LintSummary,
} from "./lint-format.js";

export { ParseError } from "./errors.js";

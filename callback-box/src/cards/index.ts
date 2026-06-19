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
  type BodyKind,
  type BodyField,
  type BodyFieldOptions,
  type FieldDecl,
  type CardSchemaConfig,
  type CardSchema,
} from "./schema.js";

export {
  splitCardContent,
  type SplitCardContent,
} from "./frontmatter.js";

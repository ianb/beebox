// Cardworks - TypeScript library for managing structured XML content

// Card
export { type Card, createCard } from "./card/index.js";

// Filesystem
export { type FileSystem } from "./fs/types.js";
export { NodeFileSystem } from "./fs/node-fs.js";
export { MemoryFileSystem } from "./fs/memory-fs.js";

// Parser
export { parseXml, parseXmlFile, parseCard, ParseError } from "./parser/parse.js";
export { splitCardContent, type SplitCardContent } from "./parser/frontmatter.js";
export {
  type ElementNode,
  type Location,
  type Comments,
  type MixedContent,
  type MixedComment,
  emptyLocation,
} from "./parser/provenance.js";
export { dedent } from "./parser/dom-to-object.js";

// Schema
export {
  element,
  ElementNodeSchema,
  type ElementConfig,
  type ElementSchema,
} from "./schema/element.js";
export { CommentsSchema, LocationSchema } from "./schema/base.js";
export {
  cardSchema,
  body,
  isBodyField,
  type BodyKind,
  type BodyField,
  type BodyFieldOptions,
  type FieldDecl,
  type CardSchemaConfig,
  type CardSchema,
} from "./schema/card-schema.js";
export { SchemaRegistry } from "./schema/registry.js";
export { formatValidationError } from "./schema/format-error.js";

// Serializer
export {
  serialize,
  escapeText,
  escapeAttr,
  type SerializeOptions,
} from "./serialize/serialize.js";

// References
export { parseRef, parseRefs } from "./refs/parse-ref.js";
export { resolveRef, resolveRefs, type RefResolver } from "./refs/resolve.js";
export {
  type ParsedRef,
  type RefFragment,
  type ResolvedRef,
} from "./refs/types.js";

// XPath
export { executeXPath, evaluateXPathString } from "./refs/xpath.js";

// Loader
export {
  CardLoader,
  MemoryCardLoader,
  ValidationError,
  type ICardLoader,
  type CardLoaderOptions,
  type MemoryCardLoaderOptions,
  type MoveResult,
  type CardReference,
} from "./loader/loader.js";

// Lint
export {
  lintCard,
  lintCards,
  lintAll,
  lintContent,
  formatLintResult,
  formatLintResults,
  formatLintResultsJson,
  type LintIssue,
  type LintResult,
  type LintSummary,
  type LintOptions,
  type FormatOptions,
} from "./lint/index.js";

// JSX
export {
  createElement,
  defineCardJSX,
  JSXValidationError,
} from "./jsx/index.js";
export type {
  InferJSXProps,
  InferJSXElements,
  CardJSXFactory,
  JSXProps,
  JSXChild,
  CreateCardOptions,
} from "./jsx/index.js";

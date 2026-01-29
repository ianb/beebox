// Cardworks - TypeScript library for managing structured XML content

// Card
export { type Card, createCard } from "./card/index.js";

// Filesystem
export { type FileSystem } from "./fs/types.js";
export { NodeFileSystem } from "./fs/node-fs.js";
export { MemoryFileSystem } from "./fs/memory-fs.js";

// Parser
export { parseXml, parseXmlFile, ParseError } from "./parser/parse.js";
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
export { SchemaRegistry } from "./schema/registry.js";

// Serializer
export { serialize, type SerializeOptions } from "./serialize/serialize.js";

// References
export { parseRef, parseRefs } from "./refs/parse-ref.js";
export { resolveRef, resolveRefs, type RefResolver } from "./refs/resolve.js";
export {
  type ParsedRef,
  type RefFragment,
  type ResolvedRef,
} from "./refs/types.js";

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
  formatLintResult,
  formatLintResults,
  formatLintResultsJson,
  type LintIssue,
  type LintResult,
  type LintSummary,
  type LintOptions,
  type FormatOptions,
} from "./lint/index.js";

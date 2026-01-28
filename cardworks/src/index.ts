// Cardworks - TypeScript library for managing structured XML content

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
  type TextSegment,
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
export {
  CommentsSchema,
  LocationSchema,
  TextSegmentSchema,
} from "./schema/base.js";
export { SchemaRegistry } from "./schema/registry.js";

// Serializer
export { serialize, type SerializeOptions } from "./serialize/serialize.js";

// References
export { parseRef } from "./refs/parse-ref.js";
export { resolveRef, type RefResolver } from "./refs/resolve.js";
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
} from "./loader/loader.js";

import type { ElementNode } from "../parser/provenance.js";
import type { ResolvedRef } from "../refs/resolve.js";
import type { SchemaRegistry } from "../schema/registry.js";
import type { ElementSchema } from "../schema/element.js";
import type { Card } from "../card/card.js";

/**
 * Result of a move operation.
 */
export interface MoveResult {
  /** Files that were moved (from -> to) */
  movedFiles: Array<{ from: string; to: string }>;
  /** Cards that had references updated */
  updatedCards: Array<{ path: string; refsUpdated: number }>;
}

/**
 * A reference from one card to another.
 */
export interface CardReference {
  /** Path of the card containing the reference */
  fromPath: string;
  /** Path of the referenced card */
  toPath: string;
  /** The original reference string as written */
  refString: string;
  /** The tag name of the element containing the reference */
  elementTagName: string;
  /** Whether this came from a `ref` or `refs` attribute */
  attributeName: "ref" | "refs";
  /** Version specified in the reference (if any) */
  version?: string;
  /** Fragment specified in the reference (if any) */
  fragment?: string;
}

/**
 * Options for creating a card loader.
 */
export interface CardLoaderOptions {
  /** Schema registry or array of schemas for validation */
  schemas?: SchemaRegistry | ElementSchema[];
  /**
   * Whether to require and add version attributes.
   * - true (default): Add version="1.0.0" on save if missing
   * - false: Don't add version, but preserve if present
   */
  requireVersion?: boolean;
  /**
   * Whether to indent serialized XML.
   * - true (default): Indent with 2 spaces
   * - false: No indentation (compact output)
   */
  indent?: boolean;
}

/**
 * Options for MemoryCardLoader.
 */
export interface MemoryCardLoaderOptions extends CardLoaderOptions {
  /** Initial files to populate the memory filesystem */
  files?: Record<string, string>;
}

/**
 * Interface for card loaders.
 */
export interface ICardLoader {
  /**
   * Load a card from a file path.
   */
  load(path: string): Promise<Card>;

  /**
   * Save a card to its file path.
   */
  save(card: Card): Promise<void>;

  /**
   * Save a card to a different path, returning a new Card.
   */
  saveAs(card: Card, newPath: string): Promise<Card>;

  /**
   * Serialize an element to XML string using the loader's options.
   */
  serialize(element: ElementNode): string;

  /**
   * Resolve a reference from a given source file.
   */
  resolveRef(ref: string, fromPath: string): Promise<ResolvedRef>;

  /**
   * Resolve multiple references from a refs attribute value.
   */
  resolveRefs(refs: string, fromPath: string): Promise<ResolvedRef[]>;

  /**
   * Check if a card file exists.
   */
  exists(path: string): Promise<boolean>;

  /**
   * Get the project root directory.
   */
  getProjectRoot(): string;

  /**
   * Move/rename a card and update all references.
   */
  move(card: Card, toPath: string): Promise<{ card: Card; result: MoveResult }>;

  /**
   * List all card files in the project.
   */
  listCards(): Promise<string[]>;

  /**
   * Find all references pointing to a given card (incoming links / backlinks).
   */
  findIncomingRefs(targetPath: string): Promise<CardReference[]>;

  /**
   * Find all references from a given card (outgoing links).
   */
  findOutgoingRefs(sourcePath: string): Promise<CardReference[]>;

  /**
   * Check if a schema is registered for a given tag name.
   */
  hasSchema(tagName: string): boolean;

  /**
   * Check if any schemas are registered.
   */
  hasAnySchemas(): boolean;

  /**
   * Validate XML content in memory without writing to disk.
   * Parses the XML and validates against the registered schema.
   * Returns the parsed element on success, throws on failure.
   *
   * @param content - XML string to validate
   * @param sourceName - Display name for error messages
   */
  validateContent(content: string, sourceName?: string): Promise<ElementNode>;
}

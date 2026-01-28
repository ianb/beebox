import type { FileSystem } from "../fs/types.js";
import type { ElementNode } from "../parser/provenance.js";
import { parseXml } from "../parser/parse.js";
import { serialize } from "../serialize/serialize.js";
import { resolveRef, type ResolvedRef } from "../refs/resolve.js";
import { NodeFileSystem } from "../fs/node-fs.js";
import { MemoryFileSystem } from "../fs/memory-fs.js";

/**
 * Interface for card loaders.
 */
export interface ICardLoader {
  /**
   * Load a card from a file path.
   */
  load(path: string): Promise<ElementNode>;

  /**
   * Save a card to a file path.
   */
  save(path: string, card: ElementNode): Promise<void>;

  /**
   * Resolve a reference from a given source file.
   */
  resolveRef(ref: string, fromPath: string): Promise<ResolvedRef>;

  /**
   * Check if a card file exists.
   */
  exists(path: string): Promise<boolean>;

  /**
   * Clear the cache.
   */
  clearCache(): void;

  /**
   * Remove a specific path from the cache.
   */
  invalidate(path: string): void;

  /**
   * Get the project root directory.
   */
  getProjectRoot(): string;
}

/**
 * Base implementation of card loader with caching and reference resolution.
 */
abstract class BaseCardLoader implements ICardLoader {
  private cache = new Map<string, ElementNode>();

  constructor(
    protected readonly fs: FileSystem,
    protected readonly projectRoot: string
  ) {}

  /**
   * Load a card from a file path.
   * Results are cached for subsequent loads.
   *
   * @param path - The absolute path to the card file
   * @returns The parsed ElementNode tree
   */
  async load(path: string): Promise<ElementNode> {
    // Check cache first
    const cached = this.cache.get(path);
    if (cached) {
      return cached;
    }

    // Read and parse
    const content = await this.fs.read(path);
    const node = await parseXml(content, path);

    // Cache the result
    this.cache.set(path, node);

    return node;
  }

  /**
   * Save a card to a file path.
   *
   * @param path - The absolute path to write to
   * @param card - The ElementNode to serialize and write
   */
  async save(path: string, card: ElementNode): Promise<void> {
    const content = serialize(card);
    await this.fs.write(path, content);

    // Update cache with the saved version
    // Re-parse to get clean location
    const reparsed = await parseXml(content, path);
    this.cache.set(path, reparsed);
  }

  /**
   * Resolve a reference from a given source file.
   *
   * @param ref - The reference string (e.g., "./Other.card@1.0.0#section")
   * @param fromPath - The path of the file containing the reference
   * @returns The resolved reference result
   */
  async resolveRef(ref: string, fromPath: string): Promise<ResolvedRef> {
    return resolveRef(ref, {
      fs: this.fs,
      projectRoot: this.projectRoot,
      currentFile: fromPath,
    });
  }

  /**
   * Check if a card file exists.
   *
   * @param path - The absolute path to check
   * @returns Whether the file exists
   */
  async exists(path: string): Promise<boolean> {
    return this.fs.exists(path);
  }

  /**
   * Clear the cache, forcing subsequent loads to read from disk.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Remove a specific path from the cache.
   *
   * @param path - The path to remove from cache
   */
  invalidate(path: string): void {
    this.cache.delete(path);
  }

  /**
   * Get the project root directory.
   */
  getProjectRoot(): string {
    return this.projectRoot;
  }
}

/**
 * Card loader for the real filesystem.
 *
 * @example
 * ```typescript
 * const loader = new CardLoader("/path/to/project");
 * const card = await loader.load("/path/to/project/cards/Recipe.card");
 * ```
 */
export class CardLoader extends BaseCardLoader {
  constructor(projectRoot: string) {
    super(new NodeFileSystem(), projectRoot);
  }
}

/**
 * Card loader with in-memory filesystem, useful for testing.
 *
 * @example
 * ```typescript
 * const loader = new MemoryCardLoader("/project", {
 *   "/project/cards/Recipe.card": `<recipe version="1.0.0">...</recipe>`,
 * });
 * const card = await loader.load("/project/cards/Recipe.card");
 * ```
 */
export class MemoryCardLoader extends BaseCardLoader {
  private memoryFs: MemoryFileSystem;

  constructor(projectRoot: string, files: Record<string, string> = {}) {
    const memoryFs = new MemoryFileSystem(files);
    super(memoryFs, projectRoot);
    this.memoryFs = memoryFs;
  }

  /**
   * Set a file's content directly.
   */
  setFile(path: string, content: string): void {
    this.memoryFs.setFile(path, content);
  }
}

import type { FileSystem } from "../fs/types.js";
import type { ElementNode } from "../parser/provenance.js";
import { parseXml } from "../parser/parse.js";
import { serialize } from "../serialize/serialize.js";
import { resolveRef, type ResolvedRef } from "../refs/resolve.js";

/**
 * Card file loader with caching and reference resolution.
 */
export class CardLoader {
  private cache = new Map<string, ElementNode>();

  constructor(
    private readonly fs: FileSystem,
    private readonly projectRoot: string
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
    // Re-parse to get clean provenance
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

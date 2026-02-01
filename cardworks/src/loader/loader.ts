import type { FileSystem } from "../fs/types.js";
import type { ElementNode } from "../parser/provenance.js";
import { parseXml } from "../parser/parse.js";
import { serialize as serializeElement } from "../serialize/serialize.js";
import { resolveRef, resolveRefs, type ResolvedRef } from "../refs/resolve.js";
import { parseRef } from "../refs/parse-ref.js";
import { NodeFileSystem } from "../fs/node-fs.js";
import { MemoryFileSystem } from "../fs/memory-fs.js";
import { SchemaRegistry } from "../schema/registry.js";
import type { ElementSchema } from "../schema/element.js";
import type { ZodError } from "zod";
import { type Card, createCard } from "../card/card.js";

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
 * Get the directory portion of a path.
 */
function dirname(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? "." : path.slice(0, lastSlash);
}

/**
 * Get the filename portion of a path.
 */
function basename(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}

/**
 * Get the extension of a filename (including the dot).
 */
function extname(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot === -1 ? "" : filename.slice(lastDot);
}

/**
 * Get the basename without extension.
 */
function basenameWithoutExt(filename: string): string {
  const ext = extname(filename);
  return ext ? filename.slice(0, -ext.length) : filename;
}

/**
 * Compute relative path from one file to another.
 */
function relativePath(from: string, to: string): string {
  const fromParts = dirname(from).split("/").filter(Boolean);
  const toParts = to.split("/").filter(Boolean);
  const toFilename = toParts.pop() ?? "";

  // Find common prefix
  let commonLength = 0;
  while (
    commonLength < fromParts.length &&
    commonLength < toParts.length &&
    fromParts[commonLength] === toParts[commonLength]
  ) {
    commonLength++;
  }

  // Build relative path
  const upCount = fromParts.length - commonLength;
  const downParts = toParts.slice(commonLength);

  const parts: string[] = [];
  for (let i = 0; i < upCount; i++) {
    parts.push("..");
  }
  parts.push(...downParts, toFilename);

  const result = parts.join("/");
  return result.startsWith(".") ? result : "./" + result;
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
 * Error thrown when card validation fails.
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly tagName: string,
    public readonly zodError: ZodError
  ) {
    super(message);
    this.name = "ValidationError";
  }
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
}

/**
 * Base implementation of card loader with reference resolution.
 */
abstract class BaseCardLoader implements ICardLoader {
  protected readonly schemas: SchemaRegistry;
  protected readonly requireVersion: boolean;
  protected readonly indent: boolean;

  constructor(
    protected readonly fs: FileSystem,
    protected readonly projectRoot: string,
    options: CardLoaderOptions = {}
  ) {
    if (options.schemas instanceof SchemaRegistry) {
      this.schemas = options.schemas;
    } else if (Array.isArray(options.schemas)) {
      this.schemas = new SchemaRegistry(options.schemas);
    } else {
      this.schemas = new SchemaRegistry();
    }
    this.requireVersion = options.requireVersion ?? false;
    this.indent = options.indent ?? false;
  }

  /**
   * Get serialization options based on loader configuration.
   */
  protected getSerializeOptions(): { indent: string } {
    return { indent: this.indent ? "  " : "" };
  }

  /**
   * Prepare element for serialization, adding version if required.
   * Returns a shallow copy if modification is needed.
   */
  protected prepareForSave(element: ElementNode): ElementNode {
    if (this.requireVersion && !element.attrs["version"]) {
      // Create shallow copy with version added
      return {
        ...element,
        attrs: { version: "1.0.0", ...element.attrs },
      };
    }
    return element;
  }

  /**
   * Serialize an element to XML string using the loader's options.
   * Adds version if requireVersion is true and element has no version.
   * Uses indent setting to format output.
   *
   * @param element - The ElementNode to serialize
   * @returns The XML string
   */
  serialize(element: ElementNode): string {
    const prepared = this.prepareForSave(element);
    return serializeElement(prepared, this.getSerializeOptions());
  }

  /**
   * Load a card from a file path.
   * If a schema is registered for the card's tag name, the card is validated.
   *
   * @param path - The absolute path to the card file
   * @returns The loaded Card
   * @throws ValidationError if validation fails
   */
  async load(path: string): Promise<Card> {
    const content = await this.fs.read(path);
    const node = await parseXml(content, path);

    // Validate against schema if registered
    const schema = this.schemas.get(node.tagName);
    if (schema) {
      const result = schema.safeParse(node);
      if (!result.success) {
        throw new ValidationError(
          `${path}: Validation failed for <${node.tagName}>: ${result.error.message}`,
          path,
          node.tagName,
          result.error
        );
      }
    }

    // Use serialized content as snapshot for consistent dirty comparison
    // Note: uses default serialize options (not loader options) since Card.isDirty()
    // compares against serializeElement() with default options
    const snapshot = serializeElement(node);
    return createCard(path, node, this.fs, snapshot);
  }

  /**
   * Save a card to its file path.
   *
   * @param card - The Card to serialize and write
   */
  async save(card: Card): Promise<void> {
    const element = this.prepareForSave(card.element);
    const content = serializeElement(element, this.getSerializeOptions());
    await this.fs.write(card.path, content);
  }

  /**
   * Save a card to a different path, returning a new Card.
   *
   * @param card - The Card to save
   * @param newPath - The new path to save to
   * @returns A new Card instance with the new path
   */
  async saveAs(card: Card, newPath: string): Promise<Card> {
    const element = this.prepareForSave(card.element);
    const content = serializeElement(element, this.getSerializeOptions());
    await this.fs.write(newPath, content);
    return createCard(newPath, card.element, this.fs, content);
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
   * Resolve multiple references from a refs attribute value.
   *
   * @param refs - Whitespace-separated reference strings
   * @param fromPath - The path of the file containing the references
   * @returns Array of resolved reference results
   */
  async resolveRefs(refs: string, fromPath: string): Promise<ResolvedRef[]> {
    return resolveRefs(refs, {
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
   * Get the project root directory.
   */
  getProjectRoot(): string {
    return this.projectRoot;
  }

  /**
   * Check if a schema is registered for a given tag name.
   */
  hasSchema(tagName: string): boolean {
    return this.schemas.has(tagName);
  }

  /**
   * Move/rename a card and update all references to it.
   *
   * @param card - The Card to move
   * @param to - The new absolute path for the card
   * @returns The updated Card and information about moved files and updated references
   * @throws Error if extension changes
   */
  async move(card: Card, to: string): Promise<{ card: Card; result: MoveResult }> {
    const from = card.path;

    // Validate extension hasn't changed
    const fromExt = extname(basename(from));
    const toExt = extname(basename(to));
    if (fromExt !== toExt) {
      throw new Error(`Cannot change extension from "${fromExt}" to "${toExt}"`);
    }

    const result: MoveResult = {
      movedFiles: [],
      updatedCards: [],
    };

    // Find related files with same basename (e.g., Recipe.card, Recipe.png)
    const fromDir = dirname(from);
    const toDir = dirname(to);
    const fromBasename = basenameWithoutExt(basename(from));
    const toBasename = basenameWithoutExt(basename(to));

    const filesInDir = await this.fs.list(fromDir);
    const relatedFiles: Array<{ from: string; to: string }> = [];

    for (const filename of filesInDir) {
      const fileBasename = basenameWithoutExt(filename);
      if (fileBasename === fromBasename) {
        const fileExt = extname(filename);
        const fromPath = `${fromDir}/${filename}`;
        const toPath = `${toDir}/${toBasename}${fileExt}`;
        relatedFiles.push({ from: fromPath, to: toPath });
      }
    }

    // Find all card files and update references
    const cardFiles = await this.listCards();

    for (const cardPath of cardFiles) {
      // Skip the card being moved (we'll move it, not update refs in it)
      if (cardPath === from) continue;

      const content = await this.fs.read(cardPath);
      const node = await parseXml(content, cardPath);

      const refsUpdated = await this.updateRefsInNode(node, cardPath, from, to);

      if (refsUpdated > 0) {
        await this.fs.write(cardPath, serializeElement(node, this.getSerializeOptions()));
        result.updatedCards.push({ path: cardPath, refsUpdated });
      }
    }

    // Now move all the related files
    for (const file of relatedFiles) {
      await this.fs.move(file.from, file.to);
      result.movedFiles.push(file);
    }

    // Return a new Card with the updated path
    const element = this.prepareForSave(card.element);
    const content = serializeElement(element, this.getSerializeOptions());
    const newCard = createCard(to, card.element, this.fs, content);

    return { card: newCard, result };
  }

  /**
   * List all card files in the project.
   */
  async listCards(): Promise<string[]> {
    return this.fs.glob(this.projectRoot, "**/*.card");
  }

  /**
   * Find all references pointing to a given card (incoming links / backlinks).
   *
   * @param targetPath - The absolute path of the card to find references to
   * @returns Array of references from other cards to the target
   */
  async findIncomingRefs(targetPath: string): Promise<CardReference[]> {
    const results: CardReference[] = [];
    const cardFiles = await this.listCards();

    for (const cardPath of cardFiles) {
      // Skip the target card itself
      if (cardPath === targetPath) continue;

      try {
        const content = await this.fs.read(cardPath);
        const node = await parseXml(content, cardPath);
        const refs = await this.collectRefsFromNode(node, cardPath);

        // Filter to refs that point to the target
        for (const ref of refs) {
          if (ref.toPath === targetPath) {
            results.push(ref);
          }
        }
      } catch {
        // Skip cards that can't be parsed
      }
    }

    return results;
  }

  /**
   * Find all references from a given card (outgoing links).
   *
   * @param sourcePath - The absolute path of the card to find references from
   * @returns Array of references from this card to other cards
   */
  async findOutgoingRefs(sourcePath: string): Promise<CardReference[]> {
    const content = await this.fs.read(sourcePath);
    const node = await parseXml(content, sourcePath);
    return this.collectRefsFromNode(node, sourcePath);
  }

  /**
   * Collect all references from a node tree.
   */
  private async collectRefsFromNode(
    node: ElementNode,
    cardPath: string
  ): Promise<CardReference[]> {
    const results: CardReference[] = [];

    // Check ref attribute (single reference)
    const refAttr = node.attrs["ref"];
    if (refAttr) {
      const ref = await this.makeCardReference(refAttr, cardPath, node.tagName, "ref");
      if (ref) {
        results.push(ref);
      }
    }

    // Check refs attribute (multiple references)
    const refsAttr = node.attrs["refs"];
    if (refsAttr) {
      const refStrings = refsAttr.split(/\s+/).filter((s) => s.length > 0);
      for (const refStr of refStrings) {
        const ref = await this.makeCardReference(refStr, cardPath, node.tagName, "refs");
        if (ref) {
          results.push(ref);
        }
      }
    }

    // Recursively collect from children
    for (const child of node.children) {
      const childRefs = await this.collectRefsFromNode(child, cardPath);
      results.push(...childRefs);
    }

    return results;
  }

  /**
   * Create a CardReference from a reference string.
   */
  private async makeCardReference(
    refStr: string,
    fromPath: string,
    elementTagName: string,
    attributeName: "ref" | "refs"
  ): Promise<CardReference | undefined> {
    try {
      const parsed = parseRef(refStr);
      const resolved = await resolveRef(refStr, {
        fs: this.fs,
        projectRoot: this.projectRoot,
        currentFile: fromPath,
      });

      // Build the reference object
      const ref: CardReference = {
        fromPath,
        toPath: resolved.resolvedPath,
        refString: refStr,
        elementTagName,
        attributeName,
      };

      // Add optional properties only if defined
      if (parsed.version !== undefined) {
        ref.version = parsed.version;
      }

      if (parsed.fragment) {
        if (parsed.fragment.type === "query") {
          ref.fragment = `query(${parsed.fragment.value})`;
        } else {
          ref.fragment = parsed.fragment.value;
        }
      }

      return ref;
    } catch {
      // Skip invalid references
      return undefined;
    }
  }

  /**
   * Update refs in a node tree that point to the moved file.
   * Returns the number of refs updated.
   */
  private async updateRefsInNode(
    node: ElementNode,
    cardPath: string,
    oldPath: string,
    newPath: string
  ): Promise<number> {
    let updated = 0;

    // Check this node's ref attribute (single reference)
    const refAttr = node.attrs["ref"];
    if (refAttr) {
      const newRef = await this.updateSingleRef(refAttr, cardPath, oldPath, newPath);
      if (newRef !== refAttr) {
        node.attrs["ref"] = newRef;
        updated++;
      }
    }

    // Check this node's refs attribute (multiple references)
    const refsAttr = node.attrs["refs"];
    if (refsAttr) {
      const refStrings = refsAttr.split(/\s+/).filter((s) => s.length > 0);
      const updatedRefs: string[] = [];
      let anyUpdated = false;

      for (const refStr of refStrings) {
        const newRef = await this.updateSingleRef(refStr, cardPath, oldPath, newPath);
        updatedRefs.push(newRef);
        if (newRef !== refStr) {
          anyUpdated = true;
          updated++;
        }
      }

      if (anyUpdated) {
        node.attrs["refs"] = updatedRefs.join(" ");
      }
    }

    // Recursively check children
    for (const child of node.children) {
      updated += await this.updateRefsInNode(child, cardPath, oldPath, newPath);
    }

    return updated;
  }

  /**
   * Update a single reference if it points to the moved file.
   * Returns the updated reference string (or original if not updated).
   */
  private async updateSingleRef(
    refStr: string,
    cardPath: string,
    oldPath: string,
    newPath: string
  ): Promise<string> {
    const parsed = parseRef(refStr);
    const resolved = await resolveRef(refStr, {
      fs: this.fs,
      projectRoot: this.projectRoot,
      currentFile: cardPath,
    });

    // Check if this ref points to the file being moved
    if (resolved.resolvedPath === oldPath) {
      // Compute new relative path
      const newRelPath = relativePath(cardPath, newPath);

      // Rebuild the ref with version and fragment preserved
      let newRef = newRelPath;
      if (parsed.version) {
        newRef += `@${parsed.version}`;
      }
      if (parsed.fragment) {
        if (parsed.fragment.type === "query") {
          newRef += `#query(${parsed.fragment.value})`;
        } else {
          newRef += `#${parsed.fragment.value}`;
        }
      }

      return newRef;
    }

    return refStr;
  }
}

/**
 * Card loader for the real filesystem.
 *
 * @example
 * ```typescript
 * const loader = new CardLoader("/path/to/project", {
 *   schemas: [RecipeSchema, IngredientSchema],
 * });
 * const card = await loader.load("/path/to/project/cards/Recipe.card");
 * ```
 */
export class CardLoader extends BaseCardLoader {
  constructor(projectRoot: string, options: CardLoaderOptions = {}) {
    super(new NodeFileSystem(), projectRoot, options);
  }
}

/**
 * Options for MemoryCardLoader.
 */
export interface MemoryCardLoaderOptions extends CardLoaderOptions {
  /** Initial files to populate the memory filesystem */
  files?: Record<string, string>;
}

/**
 * Card loader with in-memory filesystem, useful for testing.
 *
 * @example
 * ```typescript
 * const loader = new MemoryCardLoader("/project", {
 *   files: {
 *     "/project/cards/Recipe.card": `<recipe version="1.0.0">...</recipe>`,
 *   },
 *   schemas: [RecipeSchema],
 * });
 * const card = await loader.load("/project/cards/Recipe.card");
 * ```
 */
export class MemoryCardLoader extends BaseCardLoader {
  private memoryFs: MemoryFileSystem;

  constructor(projectRoot: string, options: MemoryCardLoaderOptions = {}) {
    const memoryFs = new MemoryFileSystem(options.files ?? {});
    super(memoryFs, projectRoot, options);
    this.memoryFs = memoryFs;
  }

  /**
   * Set a file's content directly.
   */
  setFile(path: string, content: string): void {
    this.memoryFs.setFile(path, content);
  }
}

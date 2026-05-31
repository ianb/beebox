import type { FileSystem } from "../fs/types.js";
import type { ElementNode } from "../parser/provenance.js";
import { parseCard } from "../parser/parse.js";
import { serialize as serializeElement } from "../serialize/serialize.js";
import { resolveRef, resolveRefs, type ResolvedRef } from "../refs/resolve.js";
import { NodeFileSystem } from "../fs/node-fs.js";
import { MemoryFileSystem } from "../fs/memory-fs.js";
import { SchemaRegistry } from "../schema/registry.js";
import { formatValidationError } from "../schema/format-error.js";
import type { ZodError } from "zod";
import { type Card, createCard } from "../card/card.js";
import { basename, dirname, extname, sharedStem } from "./path-utils.js";
import {
  collectRefsFromNode,
  updateRefsInNode,
  type RefTraversalContext,
} from "./ref-traversal.js";
import type {
  CardLoaderOptions,
  CardReference,
  ICardLoader,
  MemoryCardLoaderOptions,
  MoveResult,
} from "./types.js";

export type {
  CardLoaderOptions,
  CardReference,
  ICardLoader,
  MemoryCardLoaderOptions,
  MoveResult,
} from "./types.js";

/**
 * Details for a {@link ValidationError}.
 */
export interface ValidationErrorOptions {
  path: string;
  tagName: string;
  zodError: ZodError;
}

/**
 * Error thrown when card validation fails.
 */
export class ValidationError extends Error {
  public readonly path: string;
  public readonly tagName: string;
  public readonly zodError: ZodError;

  constructor(message: string, { path, tagName, zodError }: ValidationErrorOptions) {
    super(message);
    this.name = "ValidationError";
    this.path = path;
    this.tagName = tagName;
    this.zodError = zodError;
  }
}

/**
 * Error thrown when a move would change a card's file extension.
 */
class ExtensionChangeError extends Error {
  constructor(
    public readonly fromExt: string,
    public readonly toExt: string
  ) {
    super(`Cannot change extension from "${fromExt}" to "${toExt}"`);
    this.name = "ExtensionChangeError";
  }
}

/**
 * Constructor arguments for {@link BaseCardLoader}, grouping the filesystem
 * and loader options that come after the positional `projectRoot`.
 */
interface BaseCardLoaderArgs {
  fs: FileSystem;
  options?: CardLoaderOptions;
}

/**
 * Base implementation of card loader with reference resolution.
 */
abstract class BaseCardLoader implements ICardLoader {
  protected readonly schemas: SchemaRegistry;
  protected readonly requireVersion: boolean;
  protected readonly indent: boolean;
  protected readonly fs: FileSystem;

  constructor(
    protected readonly projectRoot: string,
    { fs, options }: BaseCardLoaderArgs
  ) {
    this.fs = fs;
    options = options ?? {};
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
    const node = await parseCard(content, { source: path });

    // Validate against schema if registered
    const schema = this.schemas.get(node.tagName);
    if (schema) {
      const result = schema.safeParse(node);
      if (!result.success) {
        const formatted = formatValidationError(result.error, node);
        const message = `${path}: Validation failed for <${node.tagName}>:\n${formatted}`;
        throw new ValidationError(message, { path, tagName: node.tagName, zodError: result.error });
      }
    }

    // Use serialized content as snapshot for consistent dirty comparison
    // Note: uses default serialize options (not loader options) since Card.isDirty()
    // compares against serializeElement() with default options
    const snapshot = serializeElement(node);
    return createCard(path, { element: node, fs: this.fs, snapshot });
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
    return createCard(newPath, { element: card.element, fs: this.fs, snapshot: content });
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
   * Check if any schemas are registered.
   */
  hasAnySchemas(): boolean {
    return !this.schemas.isEmpty();
  }

  /**
   * Validate XML content in memory without writing to disk.
   */
  async validateContent(content: string, sourceName?: string): Promise<ElementNode> {
    sourceName = sourceName ?? "<inline>";
    const node = await parseCard(content, { source: sourceName });

    const schema = this.schemas.get(node.tagName);
    if (schema) {
      const result = schema.safeParse(node);
      if (!result.success) {
        const formatted = formatValidationError(result.error, node);
        const message = `${sourceName}: Validation failed for <${node.tagName}>:\n${formatted}`;
        throw new ValidationError(message, { path: sourceName, tagName: node.tagName, zodError: result.error });
      }
    }

    return node;
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
      throw new ExtensionChangeError(fromExt, toExt);
    }

    const result: MoveResult = {
      movedFiles: [],
      updatedCards: [],
    };

    // Find related files sharing the card's stem.
    // Cards are named `Name.type.card` and pair with `Name.ext` attachments;
    // the shared stem is `Name`. sharedStem() strips `.type.card` for .card
    // files and a single extension for everything else.
    const fromDir = dirname(from);
    const toDir = dirname(to);
    const fromStem = sharedStem(basename(from));
    const toStem = sharedStem(basename(to));

    const filesInDir = await this.fs.list(fromDir);
    const relatedFiles: Array<{ from: string; to: string }> = [];

    for (const filename of filesInDir) {
      if (sharedStem(filename) !== fromStem) continue;
      const suffix = filename.slice(fromStem.length); // e.g. ".image.card" or ".jpg"
      const fromPath = `${fromDir}/${filename}`;
      const toPath = `${toDir}/${toStem}${suffix}`;
      relatedFiles.push({ from: fromPath, to: toPath });
    }

    // Find all card files and update references
    const cardFiles = await this.listCards();

    for (const cardPath of cardFiles) {
      // Skip the card being moved (we'll move it, not update refs in it)
      if (cardPath === from) continue;

      try {
        const content = await this.fs.read(cardPath);
        const node = await parseCard(content, { source: cardPath });

        const refsUpdated = await updateRefsInNode(node, {
          ctx: this.refContext(),
          cardPath,
          oldPath: from,
          newPath: to,
        });

        if (refsUpdated > 0) {
          await this.fs.write(cardPath, serializeElement(node, this.getSerializeOptions()));
          result.updatedCards.push({ path: cardPath, refsUpdated });
        }
      } catch (e) {
        // Skip cards that can't be parsed (malformed XML, etc.)
        console.warn(`Skipping card that could not be processed: ${cardPath}`, e);
        continue;
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
    const newCard = createCard(to, { element: card.element, fs: this.fs, snapshot: content });

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
        const node = await parseCard(content, { source: cardPath });
        const refs = await collectRefsFromNode(node, { ctx: this.refContext(), cardPath });

        // Filter to refs that point to the target
        for (const ref of refs) {
          if (ref.toPath === targetPath) {
            results.push(ref);
          }
        }
      } catch (e) {
        // Skip cards that can't be parsed
        console.warn(`Skipping card that could not be processed: ${cardPath}`, e);
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
    const node = await parseCard(content, { source: sourcePath });
    return collectRefsFromNode(node, { ctx: this.refContext(), cardPath: sourcePath });
  }

  /**
   * Build the context passed to the reference-traversal helpers.
   */
  private refContext(): RefTraversalContext {
    return { fs: this.fs, projectRoot: this.projectRoot };
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
  constructor(projectRoot: string, options?: CardLoaderOptions) {
    super(projectRoot, { fs: new NodeFileSystem(), options: options ?? {} });
  }
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

  constructor(projectRoot: string, options?: MemoryCardLoaderOptions) {
    options = options ?? {};
    const memoryFs = new MemoryFileSystem(options.files ?? {});
    super(projectRoot, { fs: memoryFs, options });
    this.memoryFs = memoryFs;
  }

  /**
   * Set a file's content directly.
   */
  setFile(path: string, content: string): void {
    this.memoryFs.setFile(path, content);
  }
}

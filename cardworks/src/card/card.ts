import type { ElementNode } from "../parser/provenance.js";
import type { FileSystem } from "../fs/types.js";
import { serialize } from "../serialize/serialize.js";

/**
 * A Card represents a loaded .card file with its content and metadata.
 * Cards wrap ElementNodes with file path, version, media files, and dirty tracking.
 */
export interface Card {
  /** The file path this card was loaded from (or will be saved to) */
  readonly path: string;

  /** The root element content */
  readonly element: ElementNode;

  /** Version from root element (getter for element.attrs["version"]) */
  readonly version: string;

  /** When loaded from disk (undefined for new cards that haven't been saved) */
  readonly loadedAt: Date | undefined;

  /** True if this card was created programmatically and has never been saved */
  readonly isNew: boolean;

  /** Get accompanying media files as { extension: path } */
  getMedia(): Promise<Record<string, string>>;

  /** Check if in-memory state differs from what was loaded (always true for new cards) */
  isDirty(): boolean;

  /** Check if disk file has changed since load (always false for new cards) */
  isStale(): Promise<boolean>;
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
 * Internal implementation of Card for cards loaded from disk.
 */
export class CardImpl implements Card {
  private readonly snapshot: string;
  private readonly fs: FileSystem;
  readonly isNew = false;

  constructor(
    public readonly path: string,
    public readonly element: ElementNode,
    public readonly loadedAt: Date,
    fs: FileSystem,
    snapshot: string
  ) {
    this.fs = fs;
    this.snapshot = snapshot;
    attachCardToElements(element, this);
  }

  get version(): string {
    return this.element.attrs["version"] ?? "";
  }

  isDirty(): boolean {
    return serialize(this.element) !== this.snapshot;
  }

  async isStale(): Promise<boolean> {
    try {
      const stat = await this.fs.stat(this.path);
      return stat.mtime > this.loadedAt;
    } catch {
      // File may have been deleted
      return true;
    }
  }

  async getMedia(): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const dir = dirname(this.path);
    const cardBasename = basenameWithoutExt(basename(this.path));
    const cardExt = extname(basename(this.path));

    try {
      const entries = await this.fs.list(dir);
      for (const entry of entries) {
        const entryBasename = basenameWithoutExt(entry);
        const entryExt = extname(entry);

        // Match files with same basename but different extension
        if (entryBasename === cardBasename && entryExt !== cardExt) {
          // Use extension without the dot as key
          const extKey = entryExt.startsWith(".") ? entryExt.slice(1) : entryExt;
          result[extKey] = `${dir}/${entry}`;
        }
      }
    } catch {
      // Directory may not exist or be unreadable
    }

    return result;
  }
}

/**
 * Internal implementation of Card for new cards created programmatically.
 * These cards have never been saved to disk.
 */
export class NewCardImpl implements Card {
  readonly loadedAt = undefined;
  readonly isNew = true;
  private readonly fs: FileSystem | undefined;

  constructor(
    public readonly path: string,
    public readonly element: ElementNode,
    fs?: FileSystem
  ) {
    this.fs = fs;
    attachCardToElements(element, this);
  }

  get version(): string {
    return this.element.attrs["version"] ?? "";
  }

  isDirty(): boolean {
    // New cards are always dirty (never saved)
    return true;
  }

  isStale(): Promise<boolean> {
    // New cards can't be stale (no disk version to compare)
    return Promise.resolve(false);
  }

  async getMedia(): Promise<Record<string, string>> {
    // New cards don't have media files yet
    if (!this.fs) {
      return {};
    }

    const result: Record<string, string> = {};
    const dir = dirname(this.path);
    const cardBasename = basenameWithoutExt(basename(this.path));
    const cardExt = extname(basename(this.path));

    try {
      const entries = await this.fs.list(dir);
      for (const entry of entries) {
        const entryBasename = basenameWithoutExt(entry);
        const entryExt = extname(entry);

        if (entryBasename === cardBasename && entryExt !== cardExt) {
          const extKey = entryExt.startsWith(".") ? entryExt.slice(1) : entryExt;
          result[extKey] = `${dir}/${entry}`;
        }
      }
    } catch {
      // Directory may not exist or be unreadable
    }

    return result;
  }
}

/**
 * Attach a non-enumerable card reference to an element and all its children.
 * This allows navigation from any element back to its containing card.
 */
export function attachCardToElements(element: ElementNode, card: Card): void {
  Object.defineProperty(element, "card", {
    value: card,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  for (const child of element.children) {
    attachCardToElements(child, card);
  }
  // Also attach to mixed content elements
  if (element.mixed) {
    for (const item of element.mixed) {
      if (typeof item === "object" && "tagName" in item) {
        attachCardToElements(item, card);
      }
    }
  }
}

/**
 * Create a new Card from an element and path.
 * This is used internally by CardLoader.
 */
export function createCard(
  path: string,
  element: ElementNode,
  fs: FileSystem,
  snapshot: string,
  loadedAt: Date = new Date()
): Card {
  return new CardImpl(path, element, loadedAt, fs, snapshot);
}

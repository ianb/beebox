/**
 * CardLoader factory for callback box.
 *
 * Creates a configured CardLoader instance with all known schemas.
 */

import { CardLoader, MemoryCardLoader, type CardLoaderOptions } from "cardworks";
import { createSchemaRegistry } from "../../schemas/registry.js";

export interface CreateLoaderOptions {
  /** Whether to require version attributes on cards */
  requireVersion?: boolean;
  /** Whether to indent serialized XML */
  indent?: boolean;
}

/**
 * Create a CardLoader for the given box root.
 *
 * @param boxRoot - The root directory of the callback box
 * @param options - Optional configuration
 * @returns A configured CardLoader
 */
export function createLoader(
  boxRoot: string,
  options: CreateLoaderOptions = {}
): CardLoader {
  const loaderOptions: CardLoaderOptions = {
    schemas: createSchemaRegistry(),
    requireVersion: options.requireVersion ?? false,
    indent: options.indent ?? true,
  };

  return new CardLoader(boxRoot, loaderOptions);
}

/**
 * Create an in-memory CardLoader for testing.
 *
 * @param projectRoot - The virtual project root
 * @param files - Initial file contents
 * @param options - Optional configuration
 * @returns A configured MemoryCardLoader
 */
export function createMemoryLoader(
  projectRoot: string,
  files: Record<string, string> = {},
  options: CreateLoaderOptions = {}
): MemoryCardLoader {
  return new MemoryCardLoader(projectRoot, {
    schemas: createSchemaRegistry(),
    requireVersion: options.requireVersion ?? false,
    indent: options.indent ?? true,
    files,
  });
}

// Re-export CardLoader types for convenience
export { CardLoader, MemoryCardLoader, ValidationError } from "cardworks";
export type { ICardLoader, CardLoaderOptions } from "cardworks";

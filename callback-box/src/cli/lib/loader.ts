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
 * Loads both built-in schemas and any box-local schemas from config/schemas/.
 *
 * @param boxRoot - The root directory of the callback box
 * @param options - Optional configuration
 * @returns A configured CardLoader
 */
export async function createLoader(
  boxRoot: string,
  options?: CreateLoaderOptions
): Promise<CardLoader> {
  options = options ?? {};
  const loaderOptions: CardLoaderOptions = {
    schemas: await createSchemaRegistry(boxRoot),
    requireVersion: options.requireVersion ?? false,
    indent: options.indent ?? false,
  };

  return new CardLoader(boxRoot, loaderOptions);
}

/**
 * Parameters for createMemoryLoader
 */
export interface CreateMemoryLoaderParams {
  projectRoot: string;
  files?: Record<string, string>;
  options?: CreateLoaderOptions;
}

/**
 * Create an in-memory CardLoader for testing.
 *
 * @param params - Parameters object
 * @returns A configured MemoryCardLoader
 */
export async function createMemoryLoader(
  params: CreateMemoryLoaderParams
): Promise<MemoryCardLoader> {
  const { projectRoot } = params;
  const files = params.files ?? {};
  const options = params.options ?? {};
  return new MemoryCardLoader(projectRoot, {
    schemas: await createSchemaRegistry(),
    requireVersion: options.requireVersion ?? false,
    indent: options.indent ?? false,
    files,
  });
}

// Re-export CardLoader types for convenience
export { CardLoader, MemoryCardLoader, ValidationError } from "cardworks";
export type { ICardLoader, CardLoaderOptions } from "cardworks";

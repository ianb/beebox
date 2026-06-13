/**
 * Build the LoadCardContext for a box: built-in frontmatter schemas plus
 * all element schemas (built-in and box-local). The one shared home for
 * what validate, the sdk hooks, and search each used to duplicate.
 */

import type { ElementSchema } from "cardworks";
import type { LoadCardContext } from "./card-io.js";
import { createCardSchemaMap, createSchemaRegistry } from "../schemas/registry.js";

export async function buildLoadContext(boxRoot: string): Promise<LoadCardContext> {
  const registry = await createSchemaRegistry(boxRoot);
  const elementSchemas = new Map<string, ElementSchema>();
  for (const tag of registry.tagNames()) {
    const schema = registry.get(tag);
    if (schema) elementSchemas.set(tag, schema as ElementSchema);
  }
  return { cardSchemas: await createCardSchemaMap(boxRoot), elementSchemas };
}

/**
 * Build the LoadCardContext for a box: the frontmatter card schemas (built-in
 * + box-local), keyed by type. The one shared home for what validate, the sdk
 * hooks, and search each used to duplicate.
 */

import type { LoadCardContext } from "./card-io.js";
import { createCardSchemaMap } from "../schemas/registry.js";

export async function buildLoadContext(boxRoot: string): Promise<LoadCardContext> {
  return { cardSchemas: await createCardSchemaMap(boxRoot) };
}

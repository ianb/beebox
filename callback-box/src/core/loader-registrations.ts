/**
 * Central registration of built-in file loaders.
 *
 * Imported for side effects before serving summaries. Box-local custom
 * loaders would hook in here too once that's supported.
 */

import { registerTagLoader } from "./loader-registry.js";
import { memoLoader } from "../schemas/memo.js";
import { imageLoader } from "../schemas/image.js";

let registered = false;

/**
 * Idempotently register all built-in loaders. Safe to call multiple times.
 */
export function registerBuiltinLoaders(): void {
  if (registered) return;
  registered = true;
  registerTagLoader("memo", memoLoader);
  registerTagLoader("image", imageLoader);
}

/**
 * `bbx validate`'s box-wide, checked-once-regardless-of-scope error buckets
 * — split out of `validate.ts` to keep that file under the 300-line budget.
 * Both apply to the whole box, not per-file, so they run once and merge in
 * for `--all`/`--staged`/explicit-paths scope alike.
 */

import { getBoxShape, findLegacySchemaFiles, describeLegacySchemaFiles } from "../../lib/box-shape.js";
import { checkBoxRoot } from "../../lib/box-root-check.js";

/**
 * Check for schemas left in the legacy `_config/schemas/` location.
 * Returns a one-element (or empty) array of formatted error strings —
 * an array so it composes with `countTotalErrors`/`printTextResults` like the
 * other result buckets, even though there's only ever one message.
 */
export async function checkLegacySchemaPath(boxRoot: string): Promise<string[]> {
  const shape = await getBoxShape(boxRoot);
  const files = await findLegacySchemaFiles(shape);
  return files.length > 0 ? [describeLegacySchemaFiles(shape, files)] : [];
}

/**
 * The closed-vocabulary root check (Track C,
 * `docs/implemented-plans/one-root-box-layout.md`): every box-root entry outside
 * `BOX_ROOT_VOCABULARY`, formatted as one error line each. `bbx status`'s
 * warnings-section counterpart lives directly in `status.ts` (a few lines,
 * no shared formatting worth a helper).
 */
export async function checkRootStrayErrors(boxRoot: string): Promise<string[]> {
  const strays = await checkBoxRoot(boxRoot);
  return strays.map((stray) => `Box root: ${stray.message}`);
}

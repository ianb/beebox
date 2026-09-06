/**
 * `bbx validate`'s box-wide, checked-once-regardless-of-scope error buckets
 * — split out of `validate.ts` to keep that file under the 300-line budget.
 * Both apply to the whole box, not per-file, so they run once and merge in
 * for `--all`/`--staged`/explicit-paths scope alike.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getBoxShape, findLegacySchemaFiles, describeLegacySchemaFiles } from "../../lib/box-shape.js";
import { checkBoxRoot } from "../../lib/box-root-check.js";
import { findReservedNestedSegment, reservedNestedSegmentMessage } from "../../lib/box-reserved-segments.js";
import { BOX_ROOT_VOCABULARY } from "../../lib/box-root-vocabulary.js";
import { errnoCode } from "../../lib/error-guards.js";

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

/**
 * The below-root reserved-name check (`box-reserved-segments.ts`): walk every
 * underscore area except `_tmp` (scratch — gitignored, and the one area name
 * allowed to nest) and report any entry whose path nests a reserved area
 * name. The write paths refuse to create these, so a hit here means an
 * out-of-band write (a plain `mkdir` from an agent shell, say) — exactly what
 * a box-wide validate pass exists to catch.
 */
export async function checkReservedSegmentErrors(boxRoot: string): Promise<string[]> {
  const errors: string[] = [];
  const areas = BOX_ROOT_VOCABULARY.filter((entry) => entry.kind === "area" && entry.name !== "_tmp");
  for (const area of areas) {
    let entries: string[];
    try {
      entries = await fs.readdir(path.join(boxRoot, area.name), { recursive: true });
    } catch (e) {
      if (errnoCode(e) === "ENOENT") continue;
      throw e;
    }
    for (const entry of entries.toSorted()) {
      const relativePath = area.name + "/" + entry.split(path.sep).join("/");
      const segment = findReservedNestedSegment(relativePath);
      // Report the shallowest offender once, not every descendant of it.
      if (segment !== null && relativePath.endsWith("/" + segment)) {
        errors.push(`Reserved name: ${reservedNestedSegmentMessage(relativePath, segment)}`);
      }
    }
  }
  return errors;
}

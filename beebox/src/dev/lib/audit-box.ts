/**
 * Resolve what `knowledge-audit run --box <path>` was handed into the two
 * things the runner needs: the box root to regenerate docs and run tests
 * against, and a stable identity for the context-history ledger.
 *
 * `resolveBoxRoot` tolerates a path that isn't a box at all (falls back to
 * the input path unchanged), so a non-box `--box` still produces a usable
 * (if meaningless) identity rather than throwing here.
 */

import * as path from "node:path";
import { resolveBoxRoot, getBoxShapeIfPresent } from "../../lib/box-shape.js";

export interface ResolvedAuditBox {
  /** The box root — where `.beebox/box.json`, cards, CLAUDE.md live. */
  operationalRoot: string;
  /** Ledger + report identity: the box root's basename (e.g. `test1`). */
  boxName: string;
}

export async function resolveAuditBox(inputPath: string): Promise<ResolvedAuditBox> {
  const operationalRoot = await resolveBoxRoot(path.resolve(inputPath));
  const shape = await getBoxShapeIfPresent(operationalRoot);
  const boxName = path.basename(shape.found ? shape.shape.boxRoot : operationalRoot);
  return { operationalRoot, boxName };
}

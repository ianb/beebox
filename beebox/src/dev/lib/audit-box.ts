/**
 * Resolve what `knowledge-audit run --box <path>` was handed into the two
 * things the runner needs: the operational box root to regenerate docs and run
 * tests against, and a stable identity for the context-history ledger.
 *
 * `--box` may name either a v2 package root or its nested operational
 * (`content/`) root. A package box keeps its `.beebox/box.json` marker, cards, and
 * CLAUDE.md one level down in `content/`, so pointing the doc-regen at the
 * package root ENOENTs on `.beebox/box.json`; resolving to the operational root (the same
 * resolution `bbx serve` does) targets the box itself.
 */

import * as path from "node:path";
import { resolveBoxRoot, getBoxShapeIfPresent } from "../../lib/box-shape.js";

export interface ResolvedAuditBox {
  /** The operational (`content/`) root — where `.beebox/box.json`, cards, CLAUDE.md live. */
  operationalRoot: string;
  /**
   * Ledger + report identity: the package-root basename (e.g. `test1`), stable
   * whether `--box` named the package root or its `content/` child — both
   * resolve to the same operational root, whose own basename would be the
   * useless "content". Falls back to the operational basename for a non-box path.
   */
  boxName: string;
}

export async function resolveAuditBox(inputPath: string): Promise<ResolvedAuditBox> {
  const operationalRoot = await resolveBoxRoot(path.resolve(inputPath));
  const shape = await getBoxShapeIfPresent(operationalRoot);
  const boxName = path.basename(shape.found ? shape.shape.packageRoot : operationalRoot);
  return { operationalRoot, boxName };
}

/**
 * `syncBoxGuidance`: the one walk over `GUIDANCE_SURFACES` that `initBox` and
 * the `generateDocs` template sync both run, so a surface installs the same way
 * on a new box and on every existing one.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../../../shared/error-guards.js";
import { stripLeadingMapInclude } from "../../maps/include-line.js";
import { installTemplateFile } from "../../install-template-file.js";
import { TEMPLATE_STOCK_HASHES } from "../../template-stock-hashes.js";
import { generateRules } from "../../init-rules.js";
import { invariant, assertNever } from "../../../shared/invariant.js";
import { instructionFilePath, instructionSiblingPath } from "../../agent-instruction-files.js";
import { generateSkills } from "./skills/core.js";
import { MANAGED_STOCK_TEMPLATES } from "../templates.js";
import {
  GUIDANCE_SURFACES,
  type GuidanceGenerator,
  type StockTemplateName,
} from "../guidance-surfaces.js";

const GENERATORS = {
  generateRules,
  generateSkills,
} satisfies Record<GuidanceGenerator, (boxRoot: string) => Promise<string[] | { written: string[] }>>;

/**
 * The box path a tracked row installs to. An instruction-file row resolves
 * through `instructionFilePath`, so a box not yet converted keeps its legacy
 * `CLAUDE.md` guide instead of gaining a stock `AGENTS.md` beside it.
 */
async function trackedRowPath(boxRoot: string, rowPath: string): Promise<string> {
  if (instructionSiblingPath(rowPath) === null) return rowPath;
  const dir = path.posix.dirname(rowPath);
  return instructionFilePath(boxRoot, dir === "." ? "" : dir);
}

/** Install one tracked row through the template tracker, from its stock template. */
async function installTracked(boxRoot: string, row: { path: string; template: StockTemplateName }): Promise<void> {
  const stock = MANAGED_STOCK_TEMPLATES.find((t) => t.name === row.template);
  invariant(stock !== undefined, `no MANAGED_STOCK_TEMPLATES entry for ${row.template}`);
  const relPath = await trackedRowPath(boxRoot, row.path);
  await stripStrayMapInclude(path.join(boxRoot, relPath));
  await installTemplateFile({
    boxRoot,
    relPath,
    templateContent: stock.content,
    priorStockHashes: TEMPLATE_STOCK_HASHES[row.template].superseded,
  });
}

/**
 * An earlier maps finalizer prepended its include line to tracked guides in
 * map-bearing directories, which made every later stock rewrite park. The
 * finalizer no longer touches those files; this strips what it left, so the
 * tracker compares the guide itself against stock.
 */
async function stripStrayMapInclude(absPath: string): Promise<void> {
  let existing: string;
  try {
    existing = await fs.readFile(absPath, "utf8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return;
    throw e;
  }
  const stripped = stripLeadingMapInclude(existing);
  if (stripped !== existing) await fs.writeFile(absPath, stripped);
}

interface SyncBoxGuidanceOptions {
  /**
   * Run the generator rows. `initBox` passes false: the rule generator loads
   * the box's own schemas, which a box being scaffolded does not have yet and
   * which would then sit in the process-wide schema cache, and `bbx init` runs
   * the full walk through `generateDocs` right after `initBox`.
   */
  generators: boolean;
}

/**
 * Install every registry row the walk owns: tracked rows through the template
 * tracker (a box-edited copy parks) and each generator once (a generator prunes its own marked orphans). Rows installed by another
 * owner are skipped here; the registry names that owner.
 */
export async function syncBoxGuidance(boxRoot: string, options: SyncBoxGuidanceOptions): Promise<void> {
  const generators = new Set<GuidanceGenerator>();
  for (const row of GUIDANCE_SURFACES) {
    const { install } = row;
    switch (install.via) {
      case "tracker":
        await installTracked(boxRoot, { path: row.path, template: install.template });
        break;
      case "generator":
        generators.add(install.generator);
        break;
      case "owner":
        break;
      default:
        assertNever(install);
    }
  }
  if (!options.generators) return;
  for (const name of generators) await GENERATORS[name](boxRoot);
}

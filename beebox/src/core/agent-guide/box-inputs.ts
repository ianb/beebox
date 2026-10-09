/**
 * Gather a box's agent-guide inputs without writing anything to the box: the
 * same procedures, schemas, templates, shape, personality, and guide cards
 * `generateDocs` feeds `generateAgentGuide`, read rather than compiled to disk.
 * For the read-only callers: `pnpm agent-context guide` and `pnpm lint:guide`.
 */

import { join } from "node:path";
import { fileExists } from "../../lib/file-exists.js";
import { PACKAGE_ROOT } from "../../lib/package-root.js";
import { getBoxShape } from "../../lib/box-shape.js";
import { cardSchemas, loadBoxSchemas } from "../../schemas.js";
import { getTemplatesOwnedBy } from "../../templates-registry.js";
import { scanProcedures } from "../docs-gen/compile/core.js";
import { readConfigGuides, readPersonality } from "../docs-gen/config-cards/core.js";
import type { AgentGuideOptions } from "./guide/core.js";
import { instructionFileName } from "../agent-instruction-files.js";

export async function collectGuideInputs(boxRoot: string): Promise<AgentGuideOptions> {
  const boxSchemas = await loadBoxSchemas(boxRoot);
  return {
    procedures: await scanProcedures(boxRoot),
    shape: await getBoxShape(boxRoot),
    instructionFile: await instructionFileName(boxRoot),
    allCardSchemas: [...cardSchemas.list, ...boxSchemas.cardSchemas],
    boxCardSchemas: boxSchemas.cardSchemas,
    // loadBoxSchemas registered this box's `template` exports under its root.
    boxTemplates: getTemplatesOwnedBy(boxRoot),
    engineSourcePresent: await fileExists(join(PACKAGE_ROOT, "src", "cli", "index.ts")),
    personalitySection: (await readPersonality(boxRoot))?.compiled,
    guides: (await readConfigGuides(boxRoot)).map((g) => g.summary),
  };
}

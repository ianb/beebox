/**
 * Run the agent guide's linter (`src/core/agent-guide/lint.ts`) against a
 * box: render the guide from the box's inputs (read-only), and measure the
 * always-loaded total `agent-context` would report with that render in place
 * of the box's generated copy. Used by `pnpm lint:guide` and the linter's
 * doctest.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { collectGuideInputs } from "../../core/agent-guide/box-inputs.js";
import { renderAgentGuideLines } from "../../core/agent-guide/index.js";
import { lintGuide, type GuideLintReport } from "../../core/agent-guide/lint.js";
import { loadLedger } from "../../core/agent-guide/ledger-schema.js";
import { strippedText } from "../../core/agent-guide/render.js";
import { AGENT_GUIDE_DIR, AGENT_GUIDE_FILE, withDocId } from "../../core/docs-gen/shared.js";
import { assembleContext, wordCount } from "./context-assembly/assembly.js";

export interface BoxGuideLintReport extends GuideLintReport {
  alwaysLoadedWords: number;
}

/**
 * The `agent-context chat` always-loaded total, with `guide` counted in place
 * of the box's on-disk `.beebox/agent-guide.md` (which the box's `CLAUDE.md`
 * includes), so the number reflects this render rather than the last sync.
 */
async function alwaysLoadedWith(boxRoot: string, guide: string): Promise<number> {
  const ctx = await assembleContext("chat", { boxRoot });
  const total = ctx.layers.filter((l) => l.loading === "always").reduce((n, l) => n + wordCount(l.text), 0);
  const onDisk = await readFile(join(boxRoot, AGENT_GUIDE_DIR, AGENT_GUIDE_FILE), "utf-8");
  return total - wordCount(onDisk) + wordCount(guide);
}

export async function lintBoxGuide(boxRoot: string, { checkBudget }: { checkBudget: boolean }): Promise<BoxGuideLintReport> {
  const lines = renderAgentGuideLines(await collectGuideInputs(boxRoot));
  const guide = withDocId({ relativePath: `${AGENT_GUIDE_DIR}/${AGENT_GUIDE_FILE}`, content: strippedText(lines) });
  const alwaysLoadedWords = await alwaysLoadedWith(boxRoot, guide);
  return { ...lintGuide({ ledger: loadLedger(), lines, alwaysLoadedWords, checkBudget }), alwaysLoadedWords };
}

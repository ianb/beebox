/**
 * Refresh the derived, path-loaded box rules when a card that compiles to one is
 * edited — a guide → `guides-for-*.md`, an exposition-plan → `exposition-*.md`.
 * Called from the `bbx validate` PostToolUse hook so an edit refreshes the rule
 * immediately (in context this session), not only at the next `generateDocs`.
 *
 * Each branch bulk-recompiles (fast), so it's correct even though a single card
 * triggered it. Best-effort — the hook is a nudge, so a compile failure must not
 * break it.
 */

import { compileGuides } from "./docs-gen/compile.js";
import { compileExpositionRules } from "./compile-exposition-rules.js";

export async function refreshDerivedRules(boxRoot: string, fp: string): Promise<void> {
  try {
    if (fp.endsWith(".exposition-plan.card")) {
      await compileExpositionRules(boxRoot);
    } else if (fp.endsWith(".guide.card")) {
      await compileGuides(boxRoot, false);
    }
  } catch (e) {
    console.debug("derived-rule refresh skipped:", e);
  }
}

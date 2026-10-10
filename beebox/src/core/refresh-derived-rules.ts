/**
 * Refresh the derived, path-loaded box rules when a card that compiles to one is
 * edited — a guide → `guides-for-*.md`. Called from the `bbx validate`
 * PostToolUse hook so an edit refreshes the rule immediately (in context this
 * session), not only at the next `generateDocs`.
 *
 * The compile is a bulk rewrite (fast), so it's correct even though a single
 * card triggered it. Best-effort — the hook is a nudge, so a compile failure
 * must not break it.
 */

import { compileGuides } from "./docs-gen/compile/core.js";

export async function refreshDerivedRules(boxRoot: string, fp: string): Promise<void> {
  if (!fp.endsWith(".guide.card")) return;
  try {
    await compileGuides(boxRoot);
  } catch (e) {
    console.debug("derived-rule refresh skipped:", e);
  }
}

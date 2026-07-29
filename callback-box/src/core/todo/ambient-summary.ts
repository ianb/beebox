/**
 * The ambient todo-count line (`docs/plans/todo-annotation.md` Track 5a):
 * a one-line, only-when-nonzero box-wide summary — "N open todos on the
 * plate (M escalated) — `cb todos`" — computed fresh at prompt-assembly
 * time and never persisted (a MAP.md-style persisted count would go stale
 * the first time a todo's status changed without its directory's
 * immediate-children set changing; see `src/core/maps/precheck.ts`, and
 * the plan's "NOT in scope" entry on this).
 *
 * "On the plate" means `escalated` or `on-plate` plate-state — the same
 * grouping `cb todos --on-plate` uses; `quiet` and terminal states don't
 * count. Consumed by both the reactor prompt (`reactor/prompts.ts`) and
 * the chat per-turn snapshot (`session-context.ts`), each choosing its own
 * cost/staleness tradeoff — see the two call sites for what they picked.
 */

import { collectTodos } from "./collect.js";

/** `null` when there's nothing on the plate — callers omit the line entirely. */
export async function computeTodoAmbientLine(boxRoot: string): Promise<string | null> {
  const { todos } = await collectTodos(boxRoot);
  const onPlate = todos.filter((t) => t.plateState === "escalated" || t.plateState === "on-plate");
  if (onPlate.length === 0) return null;

  const escalated = onPlate.filter((t) => t.plateState === "escalated").length;
  const escalatedNote = escalated > 0 ? ` (${String(escalated)} escalated)` : "";
  const noun = onPlate.length === 1 ? "todo" : "todos";
  return `${String(onPlate.length)} open ${noun} on the plate${escalatedNote} — \`cb todos\``;
}

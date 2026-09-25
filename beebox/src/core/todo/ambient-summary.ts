/**
 * The ambient todo-count line (`docs/implemented-plans/todo-annotation.md` Track 5a):
 * a one-line, only-when-nonzero box-wide summary — "N open todos on the
 * plate (M escalated) — `bbx query todos`" — computed fresh at prompt-assembly
 * time and never persisted (a MAP.md-style persisted count would go stale
 * the first time a todo's status changed without its directory's
 * immediate-children set changing; see `src/core/maps/precheck.ts`, and
 * the plan's "NOT in scope" entry on this).
 *
 * "On the plate" means `escalated` or `on-plate` plate-state — the same
 * grouping `bbx query todos --on-plate` uses; `quiet` and terminal states
 * don't count. It counts ALL todos, agent-assigned included. Consumed by both the reactor prompt (`reactor/prompts.ts`) and
 * the chat per-turn snapshot (`session-context.ts`), each choosing its own
 * cost/staleness tradeoff — see the two call sites for what they picked.
 */

import { runTodoQuery } from "./query.js";

/** `null` when there's nothing on the plate — callers omit the line entirely. */
export async function computeTodoAmbientLine(boxRoot: string): Promise<string | null> {
  // The box-wide reduction already counts exactly these two, over every open
  // todo in the box — so the line is a read, not a second filter that could
  // drift from what `bbx query todos` reports.
  const { reduction } = await runTodoQuery(boxRoot, {
    // `scope: "all"` — the module doc's promise that this line counts every
    // open todo, agent-assigned included, must not silently narrow just
    // because the default scope changed underneath it (Track 1).
    query: { here: "", params: { status: ["open"], scope: "all" } },
    since: null,
  });
  if (reduction.onPlate === 0) return null;

  const escalatedNote = reduction.escalated > 0 ? ` (${String(reduction.escalated)} escalated)` : "";
  const noun = reduction.onPlate === 1 ? "todo" : "todos";
  return `${String(reduction.onPlate)} open ${noun} on the plate${escalatedNote} — \`bbx query todos\``;
}

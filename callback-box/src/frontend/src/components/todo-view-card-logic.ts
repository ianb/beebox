/**
 * Pure logic for `TodoViewCard` (`docs/implemented-plans/todo-annotation.md` Track 4),
 * split out of the `.tsx` component so it's doctestable without a React
 * render harness (this repo has no component-render test setup — see
 * sibling pure-logic modules like `chat/scroll-reconcile.ts`).
 */

// Raw relative (not `@shared/…`): loaded outside Vite by the tap/tsx doctest
// runner (root tsconfig, no @shared resolution) — see OUTSIDE_VITE_SHARED_RAW
// in src/frontend/eslint.config.mjs.
import { isTodoStatus } from "../../../shared/todo-model.js";
import type { TodoStatus } from "../../../shared/todo-model.js";

/**
 * The `status` filter a `todo-view` card's frontmatter resolves to. An
 * explicit `status:` list wins; an omitted one defaults to `["open",
 * "parked"]` — every plate-state group an `open` todo can land in
 * (escalated/on-plate/quiet) PLUS `parked`, so the parked group is actually
 * reachable on the stock plate without the card author having to list
 * `parked` explicitly. Defaulting to `["open"]` alone made the parked
 * section permanently unreachable: `parked` is a STATUS, not a plate-state,
 * so it was never included by that default. `done`/`dropped` stay excluded
 * unless a card explicitly lists them.
 */
export function resolveTodoViewStatusFilter(fm: Record<string, unknown>): TodoStatus[] {
  const value = fm["status"];
  if (Array.isArray(value)) {
    const statuses = value.filter((v): v is TodoStatus => typeof v === "string" && isTodoStatus(v));
    if (statuses.length > 0) return statuses;
  }
  return ["open", "parked"];
}

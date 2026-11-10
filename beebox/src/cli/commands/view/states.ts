/**
 * `bbx view states <slug>`: print the page path that opens each state a view
 * declares in its `checkStates` export, for `bbx browser open` and
 * `bbx browser screenshot --card` (docs/implemented-plans/view-declared-check-states.md).
 *
 * The path is `/views/<card path>?<params>`. The app opens a card in the one
 * view bound to its type: the first view, by slug, whose `rendersCardTypes`
 * has it (frontend `lib/view-bindings.ts`). The other query keys reach that
 * view as `params` (frontend `lib/view-url.ts`). A state whose card would open
 * in another view gets that view's slug in place of a path.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../../lib/paths/core.js";
import { listViews } from "../../../webapp/views/compiler/compile.js";
import type { DeclaredCheckState, ViewMeta } from "../../../core/views/types.js";
import { cardTypeFromName } from "../../../shared/card-name.js";
import { errorMessage } from "../../../shared/error-guards.js";

/** The page path that opens `state` of view `slug`, or why the app would show another view. */
export function statePagePath({ slug, state, views }: { slug: string; state: DeclaredCheckState; views: readonly ViewMeta[] }): string {
  const type = cardTypeFromName(state.path);
  const bound = type === undefined ? undefined : views.toSorted((a, b) => a.slug.localeCompare(b.slug)).find((v) => v.rendersCardTypes.includes(type));
  if (bound === undefined) return `(no view renders ${type ?? "this"} cards; nothing to open)`;
  if (bound.slug !== slug) return `(${state.path} opens in view ${bound.slug}, the view bound to ${type ?? ""} cards)`;
  const cardPath = state.path.split("/").map((part) => encodeURIComponent(part)).join("/");
  const query = new URLSearchParams(state.params).toString();
  return query === "" ? `/views/${cardPath}` : `/views/${cardPath}?${query}`;
}

export const viewStatesCommand = new Command("states")
  .description("Print the page path that opens each state the view declares in checkStates")
  .argument("<slug>", "View slug (the views/<slug>.tsx basename)")
  .action(async (slug: string) => {
    try {
      const boxRoot = await requireBoxRoot();
      const views = await listViews(boxRoot);
      const view = views.find((v) => v.slug === slug);
      const problem = view === undefined ? `no view ${slug} in this box` : view.metadataError === undefined ? null : `view ${slug}: invalid metadata export ${view.metadataError}`;
      if (view === undefined || problem !== null) {
        process.stderr.write(`Error: ${problem ?? ""}\n`);
        process.exitCode = 1;
        return;
      }
      for (const state of view.checkStates) process.stdout.write(`${state.name}  ${statePagePath({ slug, state, views })}\n`);
    } catch (error) {
      process.stderr.write(`Error: ${errorMessage(error)}\n`);
      process.exitCode = 1;
    } finally {
      await (await import("esbuild")).stop();
    }
  });

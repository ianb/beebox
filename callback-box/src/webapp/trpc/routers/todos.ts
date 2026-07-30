/**
 * tRPC router for todos — query only. `todos.list` is a thin wrapper over the
 * collector (`core/todo/collect.ts`); mutation is a normal card edit (there
 * is no write endpoint — see `docs/implemented-plans/todo-annotation.md`
 * Track 3).
 */

import * as path from "node:path";
import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { collectTodos, isUnsafeGlobPattern } from "../../../core/todo/collect.js";
import type { TodoCollectionResult } from "../../../core/todo/collect-types.js";
import { TODO_STATUSES } from "../../../shared/todo-model.js";
import { boxRelativePath } from "../../../shared/box-path.js";

export const todosRouter = router({
  /**
   * `todos.list` — thin query wrapper over the collector
   * (`core/todo/collect.ts`), the `todo-view` card's data source
   * (`docs/implemented-plans/todo-annotation.md` Track 4).
   *
   * Glob resolution (one of the plan's two pinned mechanism details):
   * an explicit `glob` wins; otherwise, given `cardPath`, the glob becomes
   * `<cardPath's directory>/**` — so an omitted `glob` on a `todo-view` card
   * scopes to that card's own directory subtree; otherwise (neither given)
   * the whole box. This resolution happens HERE, not in the `todo-view`
   * schema, because `cardSchema` never sees a card's own path.
   *
   * Returns the collector's full `{ todos, issues }` plus the `effectiveGlob`
   * actually used — the frontend must be able to show "N cards couldn't be
   * read" rather than silently dropping the cards a parse/validate/load
   * failure hid, and shows the resolved glob so a subtree-scoped plate is
   * recognizable as such.
   */
  list: publicProcedure
    .input(z.object({
      cardPath: z.string().optional(),
      glob: z.string().optional(),
      status: z.array(z.enum(TODO_STATUSES)).optional(),
      assigned: z.string().optional(),
      onPlate: z.boolean().optional(),
    }).superRefine((val, ctx) => {
      // Fail closed on a path-traversal / absolute-path input rather than
      // letting it reach the collector as an uncaught throw (which would
      // surface as an opaque 500) or, worse, silently resolve outside the
      // box root. `glob` is a raw pattern handed to the `glob` package
      // (absolute patterns bypass `cwd` entirely); `cardPath` only ever
      // needs the `..`-segment check since `boxRelativePath` already strips
      // any leading slashes before it becomes part of a pattern.
      if (val.glob !== undefined && isUnsafeGlobPattern(val.glob)) {
        ctx.addIssue({
          code: "custom",
          path: ["glob"],
          message: `glob must stay within the box root — no absolute paths or ".." segments (got "${val.glob}")`,
        });
      }
      if (val.cardPath !== undefined && boxRelativePath(val.cardPath).split("/").includes("..")) {
        ctx.addIssue({
          code: "custom",
          path: ["cardPath"],
          message: `cardPath must stay within the box root — no ".." segments (got "${val.cardPath}")`,
        });
      }
    }))
    .query(async ({ input, ctx }): Promise<TodoCollectionResult & { effectiveGlob: string }> => {
      const glob = resolveGlob(input);
      const result = await collectTodos(ctx.boxRoot, glob === undefined ? undefined : { glob });

      const statusSet = input.status === undefined ? undefined : new Set(input.status);
      const onPlate = input.onPlate === true;
      const todos = result.todos.filter((todo) => {
        if (statusSet !== undefined && !statusSet.has(todo.status)) return false;
        if (input.assigned !== undefined && todo.assigned !== input.assigned) return false;
        if (onPlate && todo.plateState !== "escalated" && todo.plateState !== "on-plate") return false;
        return true;
      });

      return { todos, issues: result.issues, effectiveGlob: glob ?? "**/*.card" };
    }),
});

/**
 * Resolve the effective glob per the plan's rule: an explicit `glob` always
 * wins; otherwise a `cardPath` scopes to that card's own directory subtree
 * (`<dir>/**`); with neither, `undefined` (the collector's own box-wide
 * default, `**\/*.card`).
 */
function resolveGlob(input: { cardPath?: string | undefined; glob?: string | undefined }): string | undefined {
  if (input.glob !== undefined && input.glob !== "") return input.glob;
  if (input.cardPath === undefined || input.cardPath === "") return undefined;
  const relPath = boxRelativePath(input.cardPath);
  const dir = path.dirname(relPath);
  return dir === "." ? "**" : `${dir}/**`;
}

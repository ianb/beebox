/**
 * tRPC router for collections — query only (`docs/plans/todo-collection.md`,
 * Track 4). It replaces `todos.list`.
 *
 * The shape is the collection's, not the todo's: `collections.query` names a
 * collection and hands it a `CollectionQuery`, and the runner decides what a
 * scope, a reference pass, and a grouping mean. `collection` is a closed enum
 * with one member today — a name a box invented must not reach a server-side
 * lookup, and an unknown one should fail at the input boundary rather than
 * inside the runner.
 *
 * Mutation is not here and never will be: changing a todo is editing the card
 * it was written in (`docs/implemented-plans/todo-annotation.md`, Track 3).
 */

import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { isUnsafeGlobPattern } from "../../../core/collection/card-scope.js";
import { TodoParamsSchema } from "../../../core/todo/collection.js";
import { runTodoQuery, type TodoQueryResult } from "../../../core/todo/query.js";
import { boxRelativePath } from "../../../shared/box-path.js";

/**
 * `here` is a box-relative directory or card path, so it needs the same
 * `..`-segment refusal `todos.list` gave `cardPath` — `boxRelativePath` has
 * already stripped any leading slash by the time it becomes part of a
 * pattern, and a traversal has to fail closed rather than reach the glob.
 */
function hereEscapesBox(here: string): boolean {
  return boxRelativePath(here).split("/").includes("..");
}

const QuerySchema = z
  .object({
    here: z.string(),
    glob: z.string().optional(),
    includeReferring: z.boolean().optional(),
    group: z.enum(["place", "plate"]).optional(),
    params: TodoParamsSchema,
  })
  .superRefine((val, ctx) => {
    // A raw pattern goes to the `glob` package, where an absolute pattern
    // bypasses `cwd` entirely; an unchecked one would resolve outside the box
    // or surface as an opaque 500.
    if (val.glob !== undefined && isUnsafeGlobPattern(val.glob)) {
      ctx.addIssue({
        code: "custom",
        path: ["glob"],
        message: `glob must stay within the box root — no absolute paths or ".." segments (got "${val.glob}")`,
      });
    }
    if (hereEscapesBox(val.here)) {
      ctx.addIssue({
        code: "custom",
        path: ["here"],
        message: `here must stay within the box root — no ".." segments (got "${val.here}")`,
      });
    }
  });

export const collectionsRouter = router({
  query: publicProcedure
    .input(z.object({ collection: z.enum(["todos"]), query: QuerySchema }))
    .query(async ({ input, ctx }): Promise<TodoQueryResult> => {
      // `collection` has one member, so the dispatch is the parse. When a
      // second collection arrives this becomes a switch over the enum, and
      // the compiler will say so.
      return runTodoQuery(ctx.boxRoot, { query: input.query, since: null });
    }),
});

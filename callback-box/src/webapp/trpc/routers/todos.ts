/**
 * tRPC router for todo lists — update todo items. Rendering is handled
 * by the todo-list card renderer (TodoListView).
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc.js";
import { stageAndCommitPaths } from "../../../lib/git.js";
import { cardFields, parseCardText, serializeCardText, typeFromFilename } from "../../../core/card-io.js";
import { createCardSchemaMap } from "../../../schemas/registry.js";
import { withCardLock } from "../../../lib/card-lock.js";
import { getBoxTimeISO } from "../../../lib/time.js";
import { errorMessage } from "../../../lib/error-guards.js";
import { type TodoItem, type TodoItemStatusType, TodoListSchema } from "../../../schemas/todo-list.js";
import { collectTodos } from "../../../core/todo/collect.js";
import type { TodoCollectionResult } from "../../../core/todo/collect-types.js";
import { TODO_STATUSES } from "../../../shared/todo-model.js";
import { boxRelativePath } from "../../../shared/box-path.js";

/**
 * Find the item named `itemName` anywhere in the (possibly nested) item
 * tree and apply the new status. A `done` item gains a `completed`
 * timestamp; any other status clears it. Returns true once the item is
 * found and mutated.
 */
function updateInItems(input: {
  boxRoot: string;
  items: TodoItem[];
  itemName: string;
  status: TodoItemStatusType;
}): boolean {
  const { boxRoot, items, itemName, status } = input;
  for (const item of items) {
    if (item.name === itemName) {
      item.status = status;
      if (status === "done") {
        item.completed = getBoxTimeISO(boxRoot);
      } else {
        delete item.completed;
      }
      return true;
    }
    if (item.items !== undefined && updateInItems({ boxRoot, items: item.items, itemName, status })) {
      return true;
    }
  }
  return false;
}

export const todosRouter = router({
  updateItem: publicProcedure
    .input(z.object({
      listPath: z.string().min(1),
      itemName: z.string().min(1),
      status: z.enum(["pending", "done", "cancelled", "deferred"]),
    }))
    .mutation(async ({ input, ctx }) => {
      if (typeFromFilename(input.listPath) !== "todo-list") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Not a todo-list card" });
      }

      const fullPath = path.join(ctx.boxRoot, input.listPath);

      // Serialize the read-modify-write so two concurrent updates to the same
      // list can't both read the pre-mutation card and drop one's change.
      return withCardLock(fullPath, async () => {
        let content: string;
        try {
          content = await fs.readFile(fullPath, "utf8");
        } catch (_e) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Todo list not found: ${input.listPath}` });
        }

        const cardSchemas = await createCardSchemaMap(ctx.boxRoot);
        let parsed;
        try {
          parsed = parseCardText(content, { source: fullPath, schemas: cardSchemas, type: "todo-list" });
        } catch (e) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid todo list: ${errorMessage(e)}` });
        }

        const fields = cardFields(parsed, TodoListSchema);
        const found =
          fields.items !== undefined &&
          updateInItems({ boxRoot: ctx.boxRoot, items: fields.items, itemName: input.itemName, status: input.status });
        if (!found) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Item not found: ${input.itemName}` });
        }

        await fs.writeFile(fullPath, serializeCardText({ schema: parsed.schema, fields: parsed.fields }));
        await stageAndCommitPaths(ctx.boxRoot, {
          paths: [input.listPath],
          message: `Update todo item "${input.itemName}" to ${input.status}`,
          trailers: { Source: "webapp", Endpoint: "todos.updateItem" },
        });

        return { success: true };
      });
    }),

  /**
   * `todos.list` — thin query wrapper over the collector
   * (`core/todo/collect.ts`), the `todo-view` card's data source
   * (`docs/plans/todo-annotation.md` Track 4).
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

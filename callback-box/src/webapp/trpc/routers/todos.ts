/**
 * tRPC router for todo lists — update todo items. Rendering is handled
 * by the todo-list card renderer (TodoListView).
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc.js";
import { stageFiles, commit } from "../../../cli/lib/git.js";
import { parseCardText, serializeCardText, typeFromFilename } from "../../../core/card-io.js";
import { createCardSchemaMap } from "../../../schemas/registry.js";
import { withCardLock } from "../../../lib/card-lock.js";
import { type TodoItem, type TodoItemStatusType, type TodoListFields } from "../../../schemas/todo-list.js";

/**
 * Find the item named `itemName` anywhere in the (possibly nested) item
 * tree and apply the new status. A `done` item gains a `completed`
 * timestamp; any other status clears it. Returns true once the item is
 * found and mutated.
 */
function updateInItems(input: {
  items: TodoItem[];
  itemName: string;
  status: TodoItemStatusType;
}): boolean {
  const { items, itemName, status } = input;
  for (const item of items) {
    if (item.name === itemName) {
      item.status = status;
      if (status === "done") {
        item.completed = new Date().toISOString();
      } else {
        delete item.completed;
      }
      return true;
    }
    if (item.items !== undefined && updateInItems({ items: item.items, itemName, status })) {
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
          throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid todo list: ${(e as Error).message}` });
        }

        // parseCardText validated the fields against TodoListSchema, so the
        // shape conforms to TodoListFields — this is the parse boundary.
        const fields = parsed.fields as unknown as TodoListFields;
        const found =
          fields.items !== undefined &&
          updateInItems({ items: fields.items, itemName: input.itemName, status: input.status });
        if (!found) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Item not found: ${input.itemName}` });
        }

        await fs.writeFile(fullPath, serializeCardText({ schema: parsed.schema, fields: parsed.fields }));
        await stageFiles(ctx.boxRoot, [input.listPath]);
        await commit(ctx.boxRoot, {
          message: `Update todo item "${input.itemName}" to ${input.status}`,
          trailers: { Source: "webapp", Endpoint: "todos.updateItem" },
        });

        return { success: true };
      });
    }),
});

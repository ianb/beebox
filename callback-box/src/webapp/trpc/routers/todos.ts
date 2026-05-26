/**
 * tRPC router for todo lists — update todo items. Rendering is handled
 * by the todo-list card renderer (TodoListView).
 */

import * as path from "node:path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { CardLoader, type ElementNode } from "cardworks";
import { router, publicProcedure } from "../trpc.js";
import { stageFiles, commit } from "../../../cli/lib/git.js";

export const todosRouter = router({
  updateItem: publicProcedure
    .input(z.object({
      listPath: z.string().min(1),
      itemName: z.string().min(1),
      status: z.enum(["pending", "done", "cancelled", "deferred"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const fullPath = path.join(ctx.boxRoot, input.listPath);
      const loader = new CardLoader(ctx.boxRoot);
      let card;
      try {
        card = await loader.load(fullPath);
      } catch (_e) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Todo list not found: ${input.listPath}` });
      }

      if (card.element.tagName !== "todo-list") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Not a todo-list card" });
      }

      // Find and update the item by name (recursive)
      function updateInChildren(children: ElementNode[]): boolean {
        for (const child of children) {
          if (child.tagName === "item" && child.attrs.name === input.itemName) {
            child.attrs.status = input.status;
            if (input.status === "done") {
              child.attrs.completed = new Date().toISOString();
            } else {
              delete child.attrs.completed;
            }
            return true;
          }
          if (child.tagName === "item" && child.children) {
            if (updateInChildren(child.children as ElementNode[])) return true;
          }
        }
        return false;
      }

      const found = updateInChildren((card.element.children ?? []) as ElementNode[]);
      if (!found) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Item not found: ${input.itemName}` });
      }

      await loader.save(card);
      await stageFiles(ctx.boxRoot, [input.listPath]);
      await commit(ctx.boxRoot, {
        message: `Update todo item "${input.itemName}" to ${input.status}`,
        trailers: { Source: "webapp", Endpoint: "todos.updateItem" },
      });

      return { success: true };
    }),
});

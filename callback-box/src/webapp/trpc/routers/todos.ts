/**
 * tRPC router for todo lists — list, view, and update todo items.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { CardLoader, type ElementNode } from "cardworks";
import { router, publicProcedure } from "../trpc.js";
import { stageFiles, commit } from "../../../cli/lib/git.js";
import type { TodoList } from "../../../schemas/todo-list.js";

export interface TodoItemInfo {
  name: string;
  status: string;
  completed?: string | undefined;
  details?: string | undefined;
  children: TodoItemInfo[];
}

export interface TodoListInfo {
  relativePath: string;
  name: string;
  details?: string | undefined;
  items: TodoItemInfo[];
  counts: { pending: number; done: number; cancelled: number; deferred: number };
}

function parseItemElement(el: ElementNode): TodoItemInfo {
  const children = (el.children ?? []) as ElementNode[];
  const detailsEl = children.find((c) => c.tagName === "details");
  const subItems = children.filter((c) => c.tagName === "item");

  return {
    name: el.attrs.name as string,
    status: (el.attrs.status as string) || "pending",
    completed: el.attrs.completed as string | undefined,
    details: detailsEl ? (detailsEl.text ?? "") : undefined,
    children: subItems.map(parseItemElement),
  };
}

function countStatuses(items: TodoItemInfo[]): { pending: number; done: number; cancelled: number; deferred: number } {
  const counts = { pending: 0, done: 0, cancelled: 0, deferred: 0 };
  for (const item of items) {
    const status = item.status as keyof typeof counts;
    if (status in counts) {
      counts[status]++;
    }
    const sub = countStatuses(item.children);
    counts.pending += sub.pending;
    counts.done += sub.done;
    counts.cancelled += sub.cancelled;
    counts.deferred += sub.deferred;
  }
  return counts;
}

function parseTodoList(element: TodoList, relativePath: string): TodoListInfo {
  const children = (element.children ?? []) as ElementNode[];
  const detailsEl = children.find((c) => c.tagName === "details");
  const itemEls = children.filter((c) => c.tagName === "item");
  const items = itemEls.map(parseItemElement);

  return {
    relativePath,
    name: element.attrs.name as string,
    details: detailsEl ? (detailsEl.text ?? "") : undefined,
    items,
    counts: countStatuses(items),
  };
}

async function findTodoFiles(dir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(dir);
    return files.filter((f) => f.endsWith(".todo-list.card")).map((f) => path.join(dir, f));
  } catch (_e) {
    return [];
  }
}

export const todosRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    const todosDir = path.join(ctx.boxRoot, "store/todos");
    const deferredDir = path.join(ctx.boxRoot, "store/archive/deferred");

    const [activeFiles, deferredFiles] = await Promise.all([
      findTodoFiles(todosDir),
      findTodoFiles(deferredDir),
    ]);

    const lists: TodoListInfo[] = [];
    const loader = new CardLoader(ctx.boxRoot);

    for (const file of [...activeFiles, ...deferredFiles]) {
      try {
        const card = await loader.load(file);
        if (card.element.tagName !== "todo-list") continue;
        const relativePath = path.relative(ctx.boxRoot, file);
        lists.push(parseTodoList(card.element as TodoList, relativePath));
      } catch (_e) {
        // Skip invalid cards
      }
    }

    return { lists };
  }),

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

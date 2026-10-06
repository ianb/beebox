/**
 * The todos the server found in the card being shown (`docs/plans/todos-ui.md`,
 * Tracks 2 and 4). `FileView` provides it from the per-card summary query
 * (`CardTodos.tsx`); a rendered todo reads its plate state from it by
 * locator, since plate state depends on the box timezone and only the server
 * has that.
 *
 * Absent (no provider, or a provider for a different card, such as the host
 * of an embedded figure) means "not known": the todo renders without the
 * overdue treatment rather than borrowing another card's answer.
 */

import { createContext, useContext } from "react";
import type { TodoPlateState } from "@shared/todo-model";
import type { TodoLocator } from "@shared/todo-locators";
import { todoKey } from "../todo-view-card-logic";

interface CardTodos {
  /** The card the query read, box-relative. */
  path: string;
  /** Plate state by `todoKey`. */
  plateStates: ReadonlyMap<string, TodoPlateState>;
}

export const CardTodosContext = createContext<CardTodos | null>(null);

/** Index a query's items by the key a rendered todo will look itself up under. */
export function indexPlateStates(
  path: string,
  items: ReadonlyArray<{ path: string; locator: TodoLocator; plateState: TodoPlateState }>,
): CardTodos {
  const plateStates = new Map<string, TodoPlateState>();
  for (const item of items) {
    if (item.path === path) plateStates.set(todoKey(item), item.plateState);
  }
  return { path, plateStates };
}

/** This todo's server plate state, or `null` when it is not known (yet). */
export function usePlateState(cardPath: string | null, locator: TodoLocator | null): TodoPlateState | null {
  const todos = useContext(CardTodosContext);
  if (todos === null || cardPath === null || locator === null || todos.path !== cardPath) return null;
  return todos.plateStates.get(todoKey({ path: cardPath, locator })) ?? null;
}

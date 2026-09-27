/**
 * What a rendered todo can do (`docs/plans/todos-ui.md`, Track 3): tick it
 * (`open ↔ done`) and drop it into chat as a selection.
 *
 * The two actions reach `TodoItem` through `TodoActionsContext`, not through
 * props threaded down `Markdown`. `FileView` provides it for the card it
 * shows (`TodoActionsProvider.tsx`); every action is addressed by card path,
 * so the same provider serves the todo list, whose lines come from many
 * cards. With no provider (Markdown outside a card view) the checkbox stays
 * read-only and there is no "+". `addToChat` is `null` where the surface has
 * no chat composer to receive a selection.
 *
 * The rules a click follows are here as plain functions so they are
 * doctestable without a DOM (`test/frontend/components/todo-actions.doctest.md`).
 */

import { createContext } from "react";
import type { TodoStatus } from "@shared/todo-model";
import type { TodoLocator } from "@shared/todo-locators";
import type { AddSelectionInput } from "../../lib/selection/position";
import { errorMessage } from "@shared/error-guards";

/** One todo as the server will check it: where it is, and the words the reader saw. */
export interface TodoAddress {
  path: string;
  locator: TodoLocator;
  text: string;
}

type TickStatus = "open" | "done";

/** The `todos.setStatus` input. */
export interface SetTodoStatusInput extends TodoAddress {
  expectedStatus: TickStatus;
  status: TickStatus;
}

export interface TodoActions {
  /** Resolves when the write landed; rejects with the reason it did not. */
  setStatus: (input: SetTodoStatusInput) => Promise<void>;
  addToChat: ((todo: TodoAddress) => void) | null;
}

export const TodoActionsContext = createContext<TodoActions | null>(null);

/** The write a click asks for, or `null` when the checkbox cannot express the change (`parked`, `dropped`). */
export function tickInput(address: TodoAddress, shown: TodoStatus): SetTodoStatusInput | null {
  switch (shown) {
    case "open":
      return { ...address, expectedStatus: "open", status: "done" };
    case "done":
      return { ...address, expectedStatus: "done", status: "open" };
    case "parked":
    case "dropped":
      return null;
  }
}

/** How a tick reports back to the checkbox showing it. */
interface TickView {
  /** Show this status now (optimistic), or `null` to show the todo's own status again. */
  show: (status: TickStatus | null) => void;
  /** The reason the last tick failed, or `null` to clear it. */
  fail: (message: string | null) => void;
}

/**
 * Show the new state at once; if the write fails, put the old one back and
 * say why. A tick never fails silently (code-style, Defensiveness 5).
 */
export async function runTick(actions: TodoActions, { input, view }: { input: SetTodoStatusInput; view: TickView }): Promise<void> {
  view.fail(null);
  view.show(input.status);
  try {
    await actions.setStatus(input);
  } catch (e) {
    console.warn(`[todos] ${input.status === "done" ? "tick" : "untick"} failed for ${input.path}: ${errorMessage(e)}`);
    view.show(null);
    view.fail(errorMessage(e));
  }
}

/** Where the todo is, in the words a chat selection's `position` uses. */
function todoPosition(locator: TodoLocator): string {
  if (locator.kind === "frontmatter") return "todo in frontmatter";
  return locator.nth === undefined
    ? `todo at line ${String(locator.line)}`
    : `todo at line ${String(locator.line)} (#${String(locator.nth)} on that line)`;
}

/** The chat selection for one todo: its card (absolute ref), its words, and where it sits. */
export function todoSelection({ path, locator, text }: TodoAddress): AddSelectionInput {
  return { ref: path.startsWith("/") ? path : `/${path}`, text, position: todoPosition(locator) };
}

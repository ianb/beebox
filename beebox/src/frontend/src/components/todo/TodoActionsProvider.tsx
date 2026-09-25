/**
 * Gives the todos inside a card view their actions (`todo-actions.ts`,
 * `docs/plans/todos-ui.md` Track 3). `FileView` renders it around a card's
 * body, so a body todo, a frontmatter todo, and every line of a todo list
 * shown there can be ticked; "+" appears only when `FileView` has a chat
 * composer to add a selection to.
 *
 * After a write the `file-change` subscription refreshes the card and the
 * list (`CardTodos.tsx`, `TodoViewCard.tsx`, `file-view-data.ts`). A
 * `CONFLICT` means the todo the reader saw is no longer at that address; the
 * card and the todo queries are invalidated here too, so the reader sees the
 * current card whether or not a `file-change` arrives. A write that landed but
 * did not commit is reported as a toast.
 */

import { useMemo, type ReactNode } from "react";
import { trpc } from "../../lib/trpc";
import { toastError } from "../ui/toast-store";
import type { AddSelectionInput } from "../../lib/selection/position";
import { TodoActionsContext, todoSelection, type SetTodoStatusInput, type TodoActions } from "./todo-actions";

function isConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "data" in error
    && typeof error.data === "object" && error.data !== null && "code" in error.data && error.data.code === "CONFLICT";
}

export function TodoActionsProvider({ onAddSelection, children }: {
  onAddSelection: ((selection: AddSelectionInput) => void) | undefined;
  children: ReactNode;
}): ReactNode {
  const utils = trpc.useUtils();
  const { mutateAsync } = trpc.todos.setStatus.useMutation();

  const actions = useMemo((): TodoActions => ({
    setStatus: async (input: SetTodoStatusInput) => {
      try {
        const result = await mutateAsync(input);
        if (result.commitWarning !== null) toastError(result.commitWarning);
      } catch (error) {
        if (isConflict(error)) {
          void Promise.all([utils.card.get.invalidate({ path: input.path }), utils.collections.query.invalidate()])
            .catch((e: unknown) => { console.warn(`[todos] reload after a conflict on ${input.path} failed`, e); });
        }
        throw error;
      }
    },
    addToChat: onAddSelection === undefined ? null : (todo) => onAddSelection(todoSelection(todo)),
  }), [mutateAsync, onAddSelection, utils]);

  return <TodoActionsContext.Provider value={actions}>{children}</TodoActionsContext.Provider>;
}

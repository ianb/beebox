/**
 * A card's own todos, asked of the server once per card view
 * (`docs/plans/todos-ui.md`, Tracks 2 and 4).
 *
 * `FileView` wraps a card's rendered body in `CardTodos`. It runs one
 * `collections.query` whose `here` is the card itself (the scope glob is then
 * that one path, `core/collection/here.ts`) with no reference pass, so the
 * server reads one file. The result feeds two things:
 *
 * - the summary line above the renderer (`TodoSummaryLine`), from the
 *   reduction, which covers every status whatever the filter;
 * - `CardTodosContext`, from which each rendered todo reads its plate state
 *   by locator (`card-todos-context.ts`).
 *
 * The query is boxholder scope (the default), so agent follow-ups neither
 * count nor get a plate state. It refreshes on a `file-change` for this path.
 * On failure there is no line and the todos render without plate state; the
 * failure is logged, and the card's own load reports its own errors.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { TODO_STATUSES } from "@shared/todo-model";
import { trpc } from "../../lib/trpc";
import { busEventData } from "../../lib/bus-events";
import { fileChangeAffectsPath } from "../../lib/moved-card-recovery";
import { useBusSubscription, type RealtimeEvent } from "../../hooks/useBusSubscription";
import { CardTodosContext, indexPlateStates } from "./card-todos-context";
import { TodoSummaryLine } from "./TodoSummaryLine";
import { FIRST_OPEN_TODO_SELECTOR } from "./todo-summary";

function firstOpenTodo(container: HTMLElement | null): Element | null {
  return container === null ? null : container.querySelector(FIRST_OPEN_TODO_SELECTOR);
}

/** Every status, so the items carry plate state for each todo; the reduction counts all of them regardless. */
function cardTodosInput(path: string) {
  return {
    collection: "todos" as const,
    query: { here: path, includeReferring: false, params: { status: [...TODO_STATUSES], scope: "boxholder" as const } },
  };
}

export function CardTodos({ path, children }: { path: string; children: ReactNode }): ReactNode {
  const utils = trpc.useUtils();
  const query = trpc.collections.query.useQuery(cardTodosInput(path));
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasOpenTarget, setHasOpenTarget] = useState(false);

  useBusSubscription({
    onEvent: useCallback(
      (event: RealtimeEvent) => {
        const change = busEventData(event, "file-change");
        if (!change || !fileChangeAffectsPath(change, path)) return;
        void utils.collections.query.invalidate(cardTodosInput(path));
      },
      [utils, path],
    ),
  });

  useEffect(() => {
    if (query.error !== null) console.warn(`[card-todos] todo summary for ${path} failed: ${query.error.message}`);
  }, [query.error, path]);

  const result = query.data;
  // Whenever the body or the result changes: the renderer below may have
  // drawn todos (a core body) or none (a box view).
  useEffect(() => {
    setHasOpenTarget(firstOpenTodo(containerRef.current) !== null);
  }, [children, result]);

  const todos = result === undefined
    ? null
    : indexPlateStates(path, result.groups.flatMap((group) => group.rows.flatMap((row) => row.items)));
  const jumpToOpen = (): void => {
    firstOpenTodo(containerRef.current)?.scrollIntoView({ block: "center" });
  };

  return (
    <CardTodosContext.Provider value={todos}>
      <div ref={containerRef} className="contents">
        {result === undefined ? null : (
          <TodoSummaryLine reduction={result.reduction} onJumpToOpen={hasOpenTarget ? jumpToOpen : null} />
        )}
        {children}
      </div>
    </CardTodosContext.Provider>
  );
}

/**
 * A card's own todos, asked of the server once per card view
 * (`docs/implemented-plans/todos-ui.md`, Tracks 2 and 4).
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
 * The query is boxholder scope (the default), so agent follow-ups and
 * another person's todos neither count nor get a plate state. It refreshes on a `file-change` for this path.
 * On failure there is no line and the todos render without plate state; the
 * failure is logged, and the card's own load reports its own errors.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { TODO_STATUSES } from "@shared/todo-model";
import { trpc } from "../../lib/trpc/client";
import { fileChangeAt } from "../../lib/live-refresh";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { CardTodosContext, indexPlateStates } from "./card-todos-context";
import { TodoSummaryLine } from "./TodoSummaryLine";
import { controlTargetSelector } from "./summary";

function controlTarget(container: HTMLElement | null, reduction: { onPlate: number } | undefined): Element | null {
  return container === null || reduction === undefined ? null : container.querySelector(controlTargetSelector(reduction));
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

  useLiveRefresh({
    when: fileChangeAt(path),
    refresh: () => { void utils.collections.query.invalidate(cardTodosInput(path)); },
  });

  useEffect(() => {
    if (query.error !== null) console.warn(`[card-todos] todo summary for ${path} failed: ${query.error.message}`);
  }, [query.error, path]);

  const result = query.data;
  // Whenever the body or the result changes: the renderer below may have
  // drawn todos (a core body) or none (a box view).
  useEffect(() => {
    setHasOpenTarget(controlTarget(containerRef.current, result?.reduction) !== null);
  }, [children, result]);

  const todos = result === undefined
    ? null
    : indexPlateStates(path, result.groups.flatMap((group) => group.rows.flatMap((row) => row.items)));
  const jumpToOpen = (): void => {
    controlTarget(containerRef.current, result?.reduction)?.scrollIntoView({ block: "center" });
  };

  return (
    <CardTodosContext.Provider value={todos}>
      <div ref={containerRef} className="contents">
        {result === undefined ? null : (
          <TodoSummaryLine
            reduction={result.reduction}
            openAction={hasOpenTarget ? { onClick: jumpToOpen, title: "Go to the first open todo" } : null}
          />
        )}
        {children}
      </div>
    </CardTodosContext.Provider>
  );
}

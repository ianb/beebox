/**
 * A directory's todo line on its browse page (`docs/plans/todos-ui.md`,
 * Track 4): "3 open · 1 overdue · 2 done" for every card under it.
 *
 * One `collections.query` with `here` = the directory (its scope glob is then
 * the directory's subtree, escaped, `core/collection/here.ts`), boxholder
 * scope, and no reference pass: this runs on every directory view, and the
 * reference pass reads the whole box. Only open items come back; the
 * reduction counts every status regardless. The box root gets no line —
 * its summary is the plate and the nav badge.
 *
 * "N open" opens the directory's list (`directoryListPath`) beside the
 * browse card (Track 5). Nothing renders when the directory has no
 * boxholder todos, or while the query is loading or has failed (logged).
 */

import { useCallback, useEffect, type ReactNode } from "react";
import { trpc } from "../../lib/trpc";
import { busEventData } from "../../lib/bus-events";
import { useBusSubscription, type RealtimeEvent } from "../../hooks/useBusSubscription";
import { cardTarget, useOpenBeside } from "../chat/workspace/use-open-beside";
import { TodoSummaryLine } from "./TodoSummaryLine";
import { directoryListPath } from "./todo-summary";

function directoryTodosInput(dir: string) {
  return {
    collection: "todos" as const,
    query: { here: dir, includeReferring: false, params: { status: ["open" as const], scope: "boxholder" as const } },
  };
}

export function DirectoryTodos({ dir, cards }: {
  dir: string;
  /** The directory's own cards, from its listing, to find a `todo-view` among them. */
  cards: readonly { relativePath: string; type: string }[];
}): ReactNode {
  const utils = trpc.useUtils();
  const enabled = dir !== "";
  const query = trpc.collections.query.useQuery(directoryTodosInput(dir), { enabled });
  const openBeside = useOpenBeside();

  useBusSubscription({
    onEvent: useCallback(
      (event: RealtimeEvent) => {
        const change = busEventData(event, "file-change");
        if (!enabled || !change || !change.path.endsWith(".card") || !change.path.startsWith(`${dir}/`)) return;
        void utils.collections.query.invalidate(directoryTodosInput(dir));
      },
      [utils, dir, enabled],
    ),
  });

  useEffect(() => {
    if (query.error !== null) console.warn(`[directory-todos] todo summary for ${dir} failed: ${query.error.message}`);
  }, [query.error, dir]);

  if (!enabled || query.data === undefined) return null;
  const listPath = directoryListPath(cards);
  return (
    <TodoSummaryLine
      reduction={query.data.reduction}
      openAction={openBeside === null ? null : { onClick: () => openBeside(cardTarget(listPath)), title: "Open the todo list" }}
    />
  );
}

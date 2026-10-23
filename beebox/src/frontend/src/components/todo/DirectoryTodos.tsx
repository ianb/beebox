/**
 * A directory's todo line on its browse page (`docs/implemented-plans/todos-ui.md`,
 * Track 4): "3 now · 1 later · 2 done" for every card under it.
 * The list it opens can count more: it also shows todos elsewhere that link
 * into the folder, which this line skips (below), so the hover text says so.
 *
 * One `collections.query` with `here` = the directory (its scope glob is then
 * the directory's subtree, escaped, `core/collection/here.ts`), boxholder
 * scope, and no reference pass: this runs on every directory view, and the
 * reference pass reads the whole box. Only open items come back; the
 * reduction counts every status regardless. The box root gets no line —
 * its summary is the plate and the nav badge.
 *
 * The first count opens the directory's list (`directoryListPath`) beside the
 * browse card (Track 5). Nothing renders when the directory has no
 * boxholder todos, or while the query is loading or has failed (logged).
 */

import { useEffect, type ReactNode } from "react";
import { trpc } from "../../lib/trpc/client";
import { boxRelativePath } from "@shared/box-path";
import { busEventData } from "../../lib/bus-events";
import type { RealtimeEvent } from "../../hooks/useBusSubscription";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { cardTarget, useOpenBeside } from "../chat/workspace/use-open-beside/hook";
import { TodoSummaryLine } from "./TodoSummaryLine";
import { directoryListPath } from "./summary";

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

  // A card anywhere under `dir`, both sides compared box-relative.
  const dirPrefix = `${boxRelativePath(dir)}/`;
  useLiveRefresh({
    when: (event: RealtimeEvent) => {
      const change = busEventData(event, "file-change");
      if (!enabled || !change) return false;
      const changed = boxRelativePath(change.path);
      return changed.endsWith(".card") && changed.startsWith(dirPrefix);
    },
    refresh: () => { if (enabled) void utils.collections.query.invalidate(directoryTodosInput(dir)); },
  });

  useEffect(() => {
    if (query.error !== null) console.warn(`[directory-todos] todo summary for ${dir} failed: ${query.error.message}`);
  }, [query.error, dir]);

  if (!enabled || query.data === undefined) return null;
  const listPath = directoryListPath(cards);
  return (
    <TodoSummaryLine
      reduction={query.data.reduction}
      openAction={openBeside === null ? null : { onClick: () => openBeside(cardTarget(listPath)), title: "Todos written in this folder; open its todo list" }}
    />
  );
}

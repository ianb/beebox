/**
 * The quiet one-line todo summary at the top of a card or a directory
 * (`docs/plans/todos-ui.md`, Track 4). Presentational: `CardTodos.tsx` and
 * `DirectoryTodos.tsx` own the queries and decide what "N open" does — scroll
 * to the first open todo on a card, open the list from a directory.
 */

import { Fragment, type ReactNode } from "react";
import { InlineAction } from "../ui/InlineAction";
import { summaryParts, type SummaryReduction } from "./todo-summary";

/** What "N open" does; `null` when it has nothing to do (a box view, no pane to open in), and then the count is plain text. */
export interface OpenAction {
  onClick: () => void;
  title: string;
}

export function TodoSummaryLine({ reduction, openAction }: {
  reduction: SummaryReduction;
  openAction: OpenAction | null;
}): ReactNode {
  const parts = summaryParts(reduction);
  const handleOpen = openAction?.onClick;
  if (parts === null) return null;
  return (
    <p
      className="px-[var(--bbx-content-padding,1rem)] pt-2 text-xs text-warm-500 print:hidden"
      data-card-section="todo-summary"
    >
      {parts.map((part, i) => (
        <Fragment key={part.key}>
          {i > 0 ? " · " : null}
          {part.key === "open" && part.count > 0 && openAction !== null && handleOpen !== undefined ? (
            <InlineAction intent="subtle" onClick={handleOpen} title={openAction.title}>
              {part.text}
            </InlineAction>
          ) : (
            <span>{part.text}</span>
          )}
        </Fragment>
      ))}
    </p>
  );
}

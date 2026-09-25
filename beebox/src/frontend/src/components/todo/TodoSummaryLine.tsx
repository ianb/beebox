/**
 * The quiet one-line todo summary at the top of a card
 * (`docs/plans/todos-ui.md`, Track 4). Presentational: `CardTodos.tsx` owns
 * the query and decides whether "N open" has anything to scroll to.
 */

import { Fragment, type ReactNode } from "react";
import { InlineAction } from "../ui/InlineAction";
import { summaryParts, type SummaryReduction } from "./todo-summary";

export function TodoSummaryLine({ reduction, onJumpToOpen }: {
  reduction: SummaryReduction;
  /** Scroll to the first open todo; `null` when none is rendered (a box view), and then the count is plain text. */
  onJumpToOpen: (() => void) | null;
}): ReactNode {
  const parts = summaryParts(reduction);
  if (parts === null) return null;
  return (
    <p
      className="px-[var(--bbx-content-padding,1rem)] pt-2 text-xs text-warm-500 print:hidden"
      data-card-section="todo-summary"
    >
      {parts.map((part, i) => (
        <Fragment key={part.key}>
          {i > 0 ? " · " : null}
          {part.key === "open" && part.count > 0 && onJumpToOpen !== null ? (
            <InlineAction intent="subtle" onClick={onJumpToOpen} title="Go to the first open todo">
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

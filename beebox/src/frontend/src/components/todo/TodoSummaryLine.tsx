/**
 * The quiet one-line todo summary at the top of a card or a directory
 * (`docs/implemented-plans/todos-ui.md`, Track 4). Presentational: `CardTodos.tsx` and
 * `DirectoryTodos.tsx` own the queries and decide what "N open" does — scroll
 * to the first open todo on a card, open the list from a directory.
 *
 * `CountsLine` is the shared part: a row of counts, where a part marked
 * `action` is a control when `actions` has an entry for its key. The root
 * place page uses it for its own line (`docs/implemented-plans/front-door.md`, Track C).
 */

import { Fragment, type ReactNode } from "react";
import { InlineAction } from "../ui/InlineAction";
import { summaryParts, type SummaryPart, type SummaryReduction } from "./summary";

/** What the line's control ("N todos now", or "N later" when nothing is due now) does; `null` when it has nothing to do (a box view, no pane to open in), and then the count is plain text. */
export interface OpenAction {
  onClick: () => void;
  title: string;
}

/** What each part's control does, by part key; a part with no entry (or `null`) is plain text. */
export type CountsActions = Partial<Record<SummaryPart["key"], OpenAction | null>>;

/**
 * The counts joined by " · "; a part is a control when it is marked `action` and `actions` has its key.
 * `material` gives the controls the enclosing card's ink (the place page).
 */
export function CountsLine({ parts, actions, material }: { parts: readonly SummaryPart[]; actions: CountsActions; material?: boolean }): ReactNode {
  return parts.map((part, i) => (
    <Fragment key={part.key}>
      {i > 0 ? " · " : null}
      <CountPart text={part.text} action={part.action ? actions[part.key] : undefined} material={material} />
    </Fragment>
  ));
}

function CountPart({ text, action, material }: { text: string; action: OpenAction | null | undefined; material: boolean | undefined }): ReactNode {
  if (action === undefined || action === null) return <span>{text}</span>;
  const handleClick = action.onClick;
  return <InlineAction intent="subtle" material={material} onClick={handleClick} title={action.title}>{text}</InlineAction>;
}

export function TodoSummaryLine({ reduction, openAction }: {
  reduction: SummaryReduction;
  openAction: OpenAction | null;
}): ReactNode {
  const parts = summaryParts(reduction);
  if (parts === null) return null;
  return (
    <p
      className="px-[var(--bbx-content-padding,1rem)] pt-2 text-xs text-warm-700 print:hidden"
      data-card-section="todo-summary"
    >
      {/* The control is whichever of "now" and "later" `summaryParts` marks. */}
      <CountsLine parts={parts} actions={{ open: openAction, later: openAction }} />
    </p>
  );
}

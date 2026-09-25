/**
 * One todo, rendered the same wherever it appears (`docs/plans/todos-ui.md`,
 * Track 2): a `{% todo %}` in a card body (`Todo.tsx`, inline or block), an
 * entry of a card's frontmatter `todos:` (`FrontmatterFields.tsx`), and a line
 * of the todo list (`todo-view/ItemTree.tsx`).
 *
 * A leading checkbox, the todo's words in their status treatment, then date
 * and assignment chips. The checkbox is read-only here; Track 3 makes it
 * live. The status names it for assistive tech, so a parked or dropped todo
 * (which the checkbox cannot express) is still announced as what it is.
 *
 * Plate state is the server's (it depends on the box timezone). `null` means
 * not known yet, and then no chip takes the overdue treatment.
 */

import type { ReactNode } from "react";
import type { TodoPlateState, TodoStatus } from "@shared/todo-model";
import type { TodoLocator } from "@shared/todo-locators";
import { Badge } from "../ui/Badge";
import { dateChips, STATUS_LABEL, todoTextClass } from "./todo-item-logic";

interface TodoItemProps {
  status: TodoStatus;
  assigned: string | undefined;
  due: string | undefined;
  start: string | undefined;
  plateState: TodoPlateState | null;
  /** `inline` sits in running prose, `block` wraps block content, `line` is one row of a list. */
  layout: "inline" | "block" | "line";
  /** Where the todo lives in its card, when the surface knows it. Rendered as `data-todo-locator`. */
  locator: TodoLocator | null;
  /** Shown only as context for a nested match (the list's ancestors): muted, no chips. */
  muted: boolean;
  children: ReactNode;
}

function locatorAttr(locator: TodoLocator | null): string | undefined {
  if (locator === null) return undefined;
  if (locator.kind === "frontmatter") return `todos[${String(locator.index)}]`;
  return locator.nth === undefined ? String(locator.line) : `${String(locator.line)}#${String(locator.nth)}`;
}

function Checkbox({ status, className }: { status: TodoStatus; className: string }) {
  return (
    <input
      type="checkbox"
      checked={status === "done"}
      disabled
      readOnly
      aria-label={STATUS_LABEL[status]}
      className={`accent-warm-500 ${className}`}
    />
  );
}

function Chips({ props }: { props: TodoItemProps }) {
  const { due, start, plateState, assigned } = props;
  const dates = dateChips({ due, start, plateState }, { nowYear: new Date().getFullYear(), locale: undefined });
  if (dates.length === 0 && (assigned === undefined || assigned === "")) return null;
  return (
    <>
      {dates.map((chip) => (
        <Badge key={chip.kind} size="sm" tone={chip.warning ? "warning" : "neutral"} className="ml-1 align-middle">
          {chip.iso === null ? chip.text : <time dateTime={chip.iso}>{chip.text}</time>}
        </Badge>
      ))}
      {assigned === undefined || assigned === "" ? null : (
        <Badge size="sm" className="ml-1 align-middle" title="Assigned">{assigned}</Badge>
      )}
    </>
  );
}

export function TodoItem(props: TodoItemProps): ReactNode {
  const { status, assigned, layout, locator, muted, children } = props;
  const textClass = muted ? "text-warm-400" : todoTextClass({ status, assigned });
  const data = {
    "data-todo-status": status,
    "data-todo-assigned": assigned,
    "data-todo-locator": locatorAttr(locator),
  };
  const chips = muted ? null : <Chips props={props} />;

  switch (layout) {
    case "inline":
      return (
        <span {...data}>
          <Checkbox status={status} className="mr-1 align-middle" />
          <span className={textClass}>{children}</span>
          {chips}
        </span>
      );
    case "block":
      return (
        <div {...data} className="my-3 flex items-start gap-2">
          <Checkbox status={status} className="mt-1.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className={`[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 ${textClass}`}>{children}</div>
            {chips === null ? null : <div className="-ml-1">{chips}</div>}
          </div>
        </div>
      );
    case "line":
      return (
        <span {...data} className="text-sm">
          <Checkbox status={status} className="mr-1.5 align-middle" />
          <span className={textClass}>{children}</span>
          {chips}
        </span>
      );
  }
}

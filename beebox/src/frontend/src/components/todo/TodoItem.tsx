/**
 * One todo, rendered the same wherever it appears (`docs/plans/todos-ui.md`,
 * Track 2): a `{% todo %}` in a card body (`Todo.tsx`, inline or block), an
 * entry of a card's frontmatter `todos:` (`FrontmatterFields.tsx`), and a line
 * of the todo list (`todo-view/ItemTree.tsx`).
 *
 * A leading checkbox, the todo's words in their status treatment, then date
 * and assignment chips, then "+ to chat". The checkbox is live when the
 * surface provides `TodoActionsContext` and the todo has an address (card
 * path, locator, text); it ticks `open ↔ done` optimistically and puts the
 * old state back, with the reason beside it, when the write fails (Track 3).
 * Otherwise it is read-only. The status names it for assistive tech, so a
 * parked or dropped todo (which the checkbox cannot express, and which stays
 * disabled) is still announced as what it is.
 *
 * Plate state is the server's (it depends on the box timezone). `null` means
 * not known yet, and then no chip takes the overdue treatment.
 */

import { useContext, useState, type ReactNode } from "react";
import type { TodoPlateState, TodoStatus } from "@shared/todo-model";
import type { TodoLocator } from "@shared/todo-locators";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
import { dateChips, recheckChip, STATUS_LABEL, todoTextClass } from "./todo-item-logic";
import { runTick, tickInput, TodoActionsContext, type TodoAddress } from "./todo-actions";

interface TodoItemProps {
  status: TodoStatus;
  assigned: string | undefined;
  due: string | undefined;
  start: string | undefined;
  /** The todo-review's `recheck`; shown only as a quiet chip on a `line` (the list), never in a reading view. */
  recheck?: string | undefined;
  plateState: TodoPlateState | null;
  /** `inline` sits in running prose, `block` wraps block content, `line` is one row of a list. */
  layout: "inline" | "block" | "line";
  /** Where the todo lives in its card, when the surface knows it. Rendered as `data-todo-locator`. */
  locator: TodoLocator | null;
  /** The card the todo is in, box-relative; `null` where the surface does not know it. */
  cardPath: string | null;
  /** The todo's words as the collector extracts them, which a tick sends for the server to check; `null` when not known. */
  text: string | null;
  /** Shown only as context for a nested match (the list's ancestors): muted, no chips. */
  muted: boolean;
  children: ReactNode;
}

function locatorAttr(locator: TodoLocator | null): string | undefined {
  if (locator === null) return undefined;
  if (locator.kind === "frontmatter") return `todos[${String(locator.index)}]`;
  return locator.nth === undefined ? String(locator.line) : `${String(locator.line)}#${String(locator.nth)}`;
}

function addressOf({ cardPath, locator, text }: TodoItemProps): TodoAddress | null {
  return cardPath === null || locator === null || text === null ? null : { path: cardPath, locator, text };
}

/** What the leading checkbox shows and does, and the "+" and error that follow the chips. */
interface Controls {
  status: TodoStatus;
  /** Tick or untick; `null` when the checkbox is read-only. */
  onToggle: (() => void) | null;
  /** Add to chat; `null` when there is nowhere to add it. */
  onAddToChat: (() => void) | null;
  error: string | null;
}

function useControls(props: TodoItemProps): Controls {
  const actions = useContext(TodoActionsContext);
  // The optimistic status holds only while the todo still shows the status it
  // was ticked from; once the refreshed card arrives, the card's own wins and
  // the optimistic one is dropped (so a later change back cannot revive it).
  const [optimistic, setOptimistic] = useState<{ from: TodoStatus; to: TodoStatus } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (optimistic !== null && optimistic.from !== props.status) setOptimistic(null);
  const status = optimistic !== null && optimistic.from === props.status ? optimistic.to : props.status;
  const address = actions === null || props.muted ? null : addressOf(props);
  const input = address === null ? null : tickInput(address, status);
  const from = props.status;
  const onToggle = actions === null || input === null ? null : () => {
    void runTick(actions, {
      input,
      view: { show: (to) => setOptimistic(to === null ? null : { from, to }), fail: setError },
    });
  };
  const addToChat = actions?.addToChat ?? null;
  const onAddToChat = addToChat === null || address === null ? null : () => addToChat(address);
  return { status, onToggle, onAddToChat, error };
}

function Checkbox({ controls, className }: { controls: Controls; className: string }) {
  const { status, onToggle } = controls;
  return (
    <input
      type="checkbox"
      checked={status === "done"}
      disabled={onToggle === null}
      readOnly={onToggle === null}
      onChange={onToggle ?? undefined}
      aria-label={STATUS_LABEL[status]}
      className={`accent-warm-500 ${className}`}
    />
  );
}

/**
 * "+" and a failed tick's reason. On a device that can hover, "+" appears on
 * hover or keyboard focus within the todo, so a list of todos is not a list
 * of buttons; on touch, where there is no hover, it is always shown.
 */
function Trailing({ controls }: { controls: Controls }) {
  const { onAddToChat, error } = controls;
  return (
    <>
      {onAddToChat === null ? null : (
        <Button
          intent="ghost"
          size="sm"
          label="Add to chat"
          icon={<span aria-hidden="true">+</span>}
          onClick={onAddToChat}
          className="ml-1 h-5 w-5 align-middle [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
        />
      )}
      {error === null ? null : (
        <span role="alert" className="ml-1">
          <Text size="xs" tone="danger">{error}</Text>
        </span>
      )}
    </>
  );
}

function Chips({ props }: { props: TodoItemProps }) {
  const { due, start, plateState, assigned, status, layout } = props;
  const format = { nowYear: new Date().getFullYear(), locale: undefined };
  const dates = dateChips({ due, start, plateState }, format);
  const recheck = layout === "line" ? recheckChip({ status, recheck: props.recheck }, format) : null;
  if (dates.length === 0 && recheck === null && (assigned === undefined || assigned === "")) return null;
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
      {recheck === null ? null : (
        <span className="ml-1.5 align-middle" title="When the daily todo review looks at this again">
          <Text size="xs" tone="muted">
            {recheck.iso === null ? recheck.text : <time dateTime={recheck.iso}>{recheck.text}</time>}
          </Text>
        </span>
      )}
    </>
  );
}

export function TodoItem(props: TodoItemProps): ReactNode {
  const { assigned, layout, locator, muted, children } = props;
  const controls = useControls(props);
  const textClass = muted ? "text-warm-400" : todoTextClass({ status: controls.status, assigned });
  const data = {
    "data-todo-status": props.status,
    "data-todo-assigned": assigned,
    "data-todo-locator": locatorAttr(locator),
  };
  const chips = muted ? null : <Chips props={props} />;
  const trailing = <Trailing controls={controls} />;

  switch (layout) {
    case "inline":
      return (
        <span {...data} className="group">
          <Checkbox controls={controls} className="mr-1 align-middle" />
          <span className={textClass}>{children}</span>
          {chips}
          {trailing}
        </span>
      );
    case "block":
      return (
        <div {...data} className="group my-3 flex items-start gap-2">
          <Checkbox controls={controls} className="mt-1.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className={`[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 ${textClass}`}>{children}</div>
            <div className="-ml-1">{chips}{trailing}</div>
          </div>
        </div>
      );
    case "line":
      return (
        <span {...data} className="group text-sm">
          <Checkbox controls={controls} className="mr-1.5 align-middle" />
          <span className={textClass}>{children}</span>
          {chips}
          {trailing}
        </span>
      );
  }
}

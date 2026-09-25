/**
 * Todo tag — capture-in-place, machine-legible intention
 * (`docs/implemented-plans/todo-annotation.md`).
 *
 * `{% todo id="..." status="..." assigned="..." due="..." start="..." %}
 * …{% /todo %}` marks any span as a todo. Inline vs block is decided by the
 * Markdoc transform's `node.inline` split (`quote`/`source` precedent). Both
 * render through `TodoItem`, so a todo reads the same in a card body, in
 * frontmatter, and in the list (`docs/plans/todos-ui.md`, Track 2).
 *
 * `locator` is not an authored attribute: the `todo` transform adds it when
 * `Markdown` renders a card's body (`markdoc-config.ts`), and it is how the
 * todo finds its server plate state (`card-todos-context.ts`). Markdown
 * rendered outside a card (chat, commit messages) has no locator and no
 * plate state.
 *
 * In a card's reading view a finished agent follow-up does not render at all
 * (`hiddenInReading`).
 */

import type { ReactNode } from "react";
import { isTodoStatus, type TodoStatus } from "@shared/todo-model";
import type { TodoLocator } from "@shared/todo-locators";
import { TodoItem } from "./todo/TodoItem";
import { hiddenInReading } from "./todo/todo-item-logic";
import { usePlateState } from "./todo/card-todos-context";

function resolveStatus(status: string | undefined): TodoStatus {
  return status !== undefined && isTodoStatus(status) ? status : "open";
}

interface TodoProps {
  status?: string;
  assigned?: string;
  due?: string;
  start?: string;
  locator?: TodoLocator;
  children?: ReactNode;
}

function RenderedTodo({ props, layout, cardPath }: { props: TodoProps; layout: "inline" | "block"; cardPath: string | null }) {
  const status = resolveStatus(props.status);
  const locator = props.locator ?? null;
  const plateState = usePlateState(cardPath, locator);
  if (hiddenInReading({ status, assigned: props.assigned })) return null;
  return (
    <TodoItem
      status={status}
      assigned={props.assigned}
      due={props.due}
      start={props.start}
      plateState={plateState}
      layout={layout}
      locator={locator}
      muted={false}
    >
      {props.children}
    </TodoItem>
  );
}

export function makeTodoComponents({ cardPath }: { cardPath: string | null }): {
  TodoInline: (props: TodoProps) => ReactNode;
  TodoBlock: (props: TodoProps) => ReactNode;
} {
  function TodoInline(props: TodoProps) {
    return <RenderedTodo props={props} layout="inline" cardPath={cardPath} />;
  }

  function TodoBlock(props: TodoProps) {
    return <RenderedTodo props={props} layout="block" cardPath={cardPath} />;
  }

  return { TodoInline, TodoBlock };
}

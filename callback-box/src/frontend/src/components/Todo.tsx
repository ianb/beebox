/**
 * Todo tag — capture-in-place, machine-legible intention
 * (`docs/implemented-plans/todo-annotation.md`).
 *
 * `{% todo id="..." status="..." assigned="..." due="..." start="..." %}
 * …{% /todo %}` marks any span as a todo. Read-only rendering in v1 — no
 * click-to-toggle; the agent/human edits the annotation directly
 * (`todo-model.ts`, `markdoc-config.ts` own the vocabulary and validation).
 *
 * Status drives the visual treatment: `open` reads live (a small badge plus
 * metadata chips for `due`/`start`/`assigned` when present); `done` is
 * struck through; `parked` is dimmed (deliberately off the plate, not an
 * accident of missing metadata); `dropped` is struck through and grayed
 * (deliberately not doing). Inline vs block is decided by the Markdoc
 * transform's `node.inline` split (`quote`/`source` precedent).
 */

import type { ReactNode } from "react";
import { isTodoStatus, type TodoStatus } from "@shared/todo-model";

function resolveStatus(status: string | undefined): TodoStatus {
  return status !== undefined && isTodoStatus(status) ? status : "open";
}

const STATUS_TEXT_CLASS: Record<TodoStatus, string> = {
  open: "text-warm-800",
  done: "text-warm-400 line-through",
  parked: "text-warm-400",
  dropped: "text-warm-400 line-through",
};

const STATUS_BADGE_CLASS: Record<TodoStatus, string> = {
  open: "bg-primary-50 text-primary-dark",
  done: "bg-warm-100 text-warm-500",
  parked: "bg-warm-100 text-warm-400",
  dropped: "bg-warm-100 text-warm-400",
};

interface TodoMetaProps {
  due: string | undefined;
  start: string | undefined;
  assigned: string | undefined;
}

function TodoMeta({ due, start, assigned }: TodoMetaProps): ReactNode {
  const chips: string[] = [];
  if (due !== undefined && due !== "") chips.push(`due ${due}`);
  if (start !== undefined && start !== "") chips.push(`start ${start}`);
  if (assigned !== undefined && assigned !== "") chips.push(assigned);
  if (chips.length === 0) return null;
  return (
    <span className="ml-1 space-x-1 align-middle">
      {chips.map((chip) => (
        <span key={chip} className="rounded bg-warm-100 px-1.5 py-0.5 text-xs text-warm-500">
          {chip}
        </span>
      ))}
    </span>
  );
}

function TodoBadge({ status }: { status: TodoStatus }): ReactNode {
  return (
    <span className={`mr-1 rounded px-1.5 py-0.5 align-middle text-xs ${STATUS_BADGE_CLASS[status]}`}>
      todo
    </span>
  );
}

interface TodoProps {
  status?: string;
  assigned?: string;
  due?: string;
  start?: string;
  children?: ReactNode;
}

export function makeTodoComponents(): {
  TodoInline: (props: TodoProps) => ReactNode;
  TodoBlock: (props: TodoProps) => ReactNode;
} {
  function TodoInline({ status, assigned, due, start, children }: TodoProps) {
    const resolved = resolveStatus(status);
    return (
      <span data-todo-status={resolved} className={STATUS_TEXT_CLASS[resolved]}>
        <TodoBadge status={resolved} />
        {children}
        <TodoMeta due={due} start={start} assigned={assigned} />
      </span>
    );
  }

  function TodoBlock({ status, assigned, due, start, children }: TodoProps) {
    const resolved = resolveStatus(status);
    return (
      <div
        data-todo-status={resolved}
        className={`my-3 rounded border-l-2 border-warm-300 bg-warm-50/50 py-2 pl-4 pr-3 ${STATUS_TEXT_CLASS[resolved]}`}
      >
        <div className="mb-1">
          <TodoBadge status={resolved} />
          <TodoMeta due={due} start={start} assigned={assigned} />
        </div>
        <div className="[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">{children}</div>
      </div>
    );
  }

  return { TodoInline, TodoBlock };
}

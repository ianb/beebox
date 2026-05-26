/**
 * TodoListView — card renderer for todo-list cards.
 *
 * Parses the XML element into items + nested sub-items, renders them with a
 * tri-state round checkbox (pending/done/deferred), and toggles status via
 * the todos.updateItem mutation.
 *
 * Lives in components/ because the bespoke round-checkbox look is
 * appearance-heavy.
 */

import { cbSource, cbSourceItem } from "../lib/source-tag";
import { trpc } from "../lib/trpc";
import type { ElementNode } from "../api";
import type { RendererProps } from "../renderers";

interface TodoItemInfo {
  name: string;
  status: string;
  details?: string | undefined;
  children: TodoItemInfo[];
}

interface TodoListInfo {
  name: string;
  details?: string | undefined;
  items: TodoItemInfo[];
  counts: { pending: number; done: number; cancelled: number; deferred: number };
}

function parseItem(el: ElementNode): TodoItemInfo {
  const children = el.children ?? [];
  const detailsEl = children.find((c) => c.tagName === "details");
  const subItems = children.filter((c) => c.tagName === "item");

  return {
    name: el.attrs.name ?? "",
    status: el.attrs.status ?? "pending",
    details: detailsEl ? (detailsEl.text ?? "") : undefined,
    children: subItems.map(parseItem),
  };
}

function countStatuses(items: TodoItemInfo[]): TodoListInfo["counts"] {
  const counts = { pending: 0, done: 0, cancelled: 0, deferred: 0 };
  for (const item of items) {
    const status = item.status as keyof typeof counts;
    if (status in counts) counts[status]++;
    const sub = countStatuses(item.children);
    counts.pending += sub.pending;
    counts.done += sub.done;
    counts.cancelled += sub.cancelled;
    counts.deferred += sub.deferred;
  }
  return counts;
}

function parseTodoList(element: ElementNode): TodoListInfo {
  const children = element.children ?? [];
  const detailsEl = children.find((c) => c.tagName === "details");
  const itemEls = children.filter((c) => c.tagName === "item");
  const items = itemEls.map(parseItem);

  return {
    name: element.attrs.name ?? "",
    details: detailsEl ? (detailsEl.text ?? "") : undefined,
    items,
    counts: countStatuses(items),
  };
}

interface TodoItemProps {
  item: TodoItemInfo;
  onToggle: (itemName: string, newStatus: string) => void;
}

function TodoItem({ item, onToggle }: TodoItemProps) {
  const isDone = item.status === "done" || item.status === "cancelled";

  return (
    <div className="py-1" {...cbSourceItem(`item: ${item.name}`)}>
      <div className="flex items-start gap-2">
        <button
          onClick={() => onToggle(item.name, isDone ? "pending" : "done")}
          className={`mt-0.5 w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
            isDone
              ? "bg-primary border-primary text-white"
              : item.status === "deferred"
                ? "border-warm-300 bg-warm-100"
                : "border-warm-400 hover:border-primary"
          }`}
          title={isDone ? "Mark pending" : "Mark done"}
        >
          {isDone ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 6l3 3 5-5" />
            </svg>
          ) : null}
        </button>
        <div className="flex-1 min-w-0">
          <span className={`text-sm ${
            isDone
              ? "line-through text-warm-500"
              : item.status === "deferred"
                ? "text-warm-500 italic"
                : "text-warm-900"
          }`}>
            {item.name}
          </span>
          {item.status === "deferred" ? (
            <span className="ml-2 text-xs text-warm-400">deferred</span>
          ) : null}
          {item.details ? (
            <p className="text-xs text-warm-600 mt-0.5">{item.details}</p>
          ) : null}
          {item.children.length > 0 ? (
            <div className="ml-4 mt-1">
              {item.children.map((child) => (
                <TodoItem
                  key={child.name}
                  item={child}
                  onToggle={onToggle}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function TodoListView({ data }: RendererProps) {
  const utils = trpc.useUtils();
  const updateMutation = trpc.todos.updateItem.useMutation({
    onSuccess: () => {
      utils.card.get.invalidate({ path: data.path });
    },
  });

  if (!data.element) {
    return <div className="p-4 text-warm-600">No todo list data</div>;
  }

  const list = parseTodoList(data.element);
  const total = list.counts.pending + list.counts.done + list.counts.cancelled + list.counts.deferred;
  const completed = list.counts.done + list.counts.cancelled;

  const handleToggle = (itemName: string, newStatus: string) => {
    updateMutation.mutate({
      listPath: data.path,
      itemName,
      status: newStatus as "pending" | "done" | "cancelled" | "deferred",
    });
  };

  return (
    <div className="bg-white rounded-lg border border-warm-200 shadow-sm" {...cbSource("card", data.path)}>
      <div className="px-4 py-3 border-b border-warm-100">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-warm-900">{list.name}</h2>
          <span className="text-xs text-warm-500">
            {completed}/{total}
          </span>
        </div>
        {list.details ? (
          <p className="text-sm text-warm-600 mt-1">{list.details}</p>
        ) : null}
      </div>
      <div className="px-4 py-2">
        {list.items.map((item) => (
          <TodoItem
            key={item.name}
            item={item}
            onToggle={handleToggle}
          />
        ))}
      </div>
    </div>
  );
}

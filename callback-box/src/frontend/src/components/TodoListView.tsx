/**
 * TodoListView — card renderer for todo-list cards.
 *
 * Reads the card's frontmatter (`name`, `details`, nested `items`) into a
 * render tree and draws each item as a row with two controls:
 *
 * - a round checkbox for the fast pending↔done toggle (the common action),
 * - a `⋯` menu exposing all four statuses (pending/done/cancelled/deferred)
 *   so the rarer cancelled/deferred states are reachable from the UI.
 *
 * Both go through the todos.updateItem mutation. Lives in components/
 * because the bespoke round-checkbox + status look is appearance-heavy.
 */

import { isRecord } from "../lib/is-record";
import { Dropdown, MenuItem } from "./ui/Dropdown";
import { cbSource, cbSourceItem } from "../lib/source-tag";
import { trpc } from "../lib/trpc";
import type { RendererProps } from "../renderers";
import type { TodoItemStatusType } from "../../../schemas/todo-list";

const STATUS_OPTIONS: ReadonlyArray<{ value: TodoItemStatusType; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
  { value: "deferred", label: "Deferred" },
];

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


function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function itemArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function parseItem(raw: unknown): TodoItemInfo | null {
  if (!isRecord(raw)) return null;
  const children: TodoItemInfo[] = [];
  for (const sub of itemArray(raw, "items")) {
    const parsed = parseItem(sub);
    if (parsed !== null) children.push(parsed);
  }
  const status = stringField(raw, "status");
  return {
    name: stringField(raw, "name") ?? "",
    status: status === undefined ? "pending" : status,
    details: stringField(raw, "details"),
    children,
  };
}

function isStatusCountKey(status: string, counts: TodoListInfo["counts"]): status is keyof TodoListInfo["counts"] {
  return status in counts;
}

function countStatuses(items: TodoItemInfo[]): TodoListInfo["counts"] {
  const counts = { pending: 0, done: 0, cancelled: 0, deferred: 0 };
  for (const item of items) {
    const { status } = item;
    if (isStatusCountKey(status, counts)) counts[status]++;
    const sub = countStatuses(item.children);
    counts.pending += sub.pending;
    counts.done += sub.done;
    counts.cancelled += sub.cancelled;
    counts.deferred += sub.deferred;
  }
  return counts;
}

function parseTodoList(frontmatter: Record<string, unknown>): TodoListInfo {
  const items: TodoItemInfo[] = [];
  for (const raw of itemArray(frontmatter, "items")) {
    const parsed = parseItem(raw);
    if (parsed !== null) items.push(parsed);
  }

  return {
    name: stringField(frontmatter, "name") ?? "",
    details: stringField(frontmatter, "details"),
    items,
    counts: countStatuses(items),
  };
}

interface TodoItemProps {
  item: TodoItemInfo;
  onToggle: (itemName: string, newStatus: TodoItemStatusType) => void;
}

/** Round-checkbox appearance for each status (box classes + inner mark). */
function statusBox(status: string): { boxClass: string; mark: JSX.Element | null } {
  switch (status) {
    case "done":
      return {
        boxClass: "bg-primary border-primary text-white",
        mark: (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 6l3 3 5-5" />
          </svg>
        ),
      };
    case "cancelled":
      return {
        boxClass: "border-warm-400 bg-warm-100 text-warm-500",
        mark: (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3l6 6M9 3l-6 6" />
          </svg>
        ),
      };
    case "deferred":
      return { boxClass: "border-warm-300 bg-warm-100", mark: null };
    default:
      return { boxClass: "border-warm-400 hover:border-primary", mark: null };
  }
}

/** Name-text appearance + a trailing status label for the non-binary states. */
function statusText(status: string): { textClass: string; label: string | null } {
  switch (status) {
    case "done":
      return { textClass: "line-through text-warm-500", label: null };
    case "cancelled":
      return { textClass: "line-through text-warm-400", label: "cancelled" };
    case "deferred":
      return { textClass: "text-warm-500 italic", label: "deferred" };
    default:
      return { textClass: "text-warm-900", label: null };
  }
}

function TodoItem({ item, onToggle }: TodoItemProps) {
  const { boxClass, mark } = statusBox(item.status);
  const { textClass, label } = statusText(item.status);
  const isDone = item.status === "done";

  return (
    <div className="py-1" {...cbSourceItem(`item: ${item.name}`)}>
      <div className="flex items-start gap-2">
        <button
          onClick={() => onToggle(item.name, isDone ? "pending" : "done")}
          className={`mt-0.5 w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${boxClass}`}
          title={isDone ? "Mark pending" : "Mark done"}
        >
          {mark}
        </button>
        <div className="flex-1 min-w-0">
          <span className={`text-sm ${textClass}`}>{item.name}</span>
          {label !== null ? (
            <span className="ml-2 text-xs text-warm-400">{label}</span>
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
        <Dropdown
          align="right"
          width="w-40"
          dense
          className="flex-shrink-0"
          trigger={({ toggle, open, ariaProps }) => (
            <button
              type="button"
              onClick={toggle}
              {...ariaProps}
              aria-label="Change status"
              title="Change status"
              className={`mt-0.5 p-1 rounded text-warm-400 hover:text-warm-700 hover:bg-warm-100 transition-colors ${
                open ? "bg-warm-100 text-warm-700" : ""
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <circle cx="3" cy="8" r="1.4" />
                <circle cx="8" cy="8" r="1.4" />
                <circle cx="13" cy="8" r="1.4" />
              </svg>
            </button>
          )}
        >
          {STATUS_OPTIONS.map((option) => (
            <MenuItem
              key={option.value}
              active={item.status === option.value}
              onClick={() => onToggle(item.name, option.value)}
            >
              {option.label}
            </MenuItem>
          ))}
        </Dropdown>
      </div>
    </div>
  );
}

export function TodoListView({ data }: RendererProps) {
  const utils = trpc.useUtils();
  const updateMutation = trpc.todos.updateItem.useMutation({
    onSuccess: () => {
      // Fire-and-forget refresh trigger; failure surfaces via query error state.
      void utils.card.get.invalidate({ path: data.path });
    },
  });

  if (!data.frontmatter) {
    return <div className="p-4 text-warm-600">No todo list data</div>;
  }

  const list = parseTodoList(data.frontmatter);
  const total = list.counts.pending + list.counts.done + list.counts.cancelled + list.counts.deferred;
  const completed = list.counts.done + list.counts.cancelled;

  const handleToggle = (itemName: string, newStatus: TodoItemStatusType) => {
    updateMutation.mutate({
      listPath: data.path,
      itemName,
      status: newStatus,
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

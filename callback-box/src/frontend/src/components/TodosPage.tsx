/**
 * Todos page — view and manage todo lists.
 */

import { getEventSourceBase } from "../api";
import { trpc } from "../lib/trpc";
import { useSSE } from "../hooks/useSSE";
import type { RouterOutput } from "../lib/trpc";

type TodoItemInfo = RouterOutput["todos"]["list"]["lists"][number]["items"][number];

function TodoItem(props: {
  item: TodoItemInfo;
  listPath: string;
  onToggle: (itemName: string, newStatus: string) => void;
}) {
  const { item, listPath, onToggle } = props;
  const isDone = item.status === "done" || item.status === "cancelled";

  return (
    <div className="py-1">
      <div className="flex items-start gap-2">
        <button
          onClick={() => onToggle(item.name, isDone ? "pending" : "done")}
          className={`mt-0.5 w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
            isDone
              ? "bg-plum border-plum text-white"
              : item.status === "deferred"
                ? "border-warm-300 bg-warm-100"
                : "border-warm-400 hover:border-plum"
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
                  listPath={listPath}
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

function TodoListCard(props: {
  list: RouterOutput["todos"]["list"]["lists"][number];
}) {
  const { list } = props;
  const utils = trpc.useUtils();
  const updateMutation = trpc.todos.updateItem.useMutation({
    onSuccess: () => {
      utils.todos.list.invalidate();
    },
  });

  const handleToggle = (itemName: string, newStatus: string) => {
    updateMutation.mutate({
      listPath: list.relativePath,
      itemName,
      status: newStatus as "pending" | "done" | "cancelled" | "deferred",
    });
  };

  const total = list.counts.pending + list.counts.done + list.counts.cancelled + list.counts.deferred;
  const completed = list.counts.done + list.counts.cancelled;

  return (
    <div className="bg-white rounded-lg border border-warm-200 shadow-sm">
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
            listPath={list.relativePath}
            onToggle={handleToggle}
          />
        ))}
      </div>
    </div>
  );
}

export function TodosPage() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.todos.list.useQuery();

  useSSE(`${getEventSourceBase()}/events`, {
    onEvent: (event) => {
      if (event.event === "file-change" || event.event === "card-created") {
        utils.todos.list.invalidate();
      }
    },
  });

  const lists = data ? data.lists : [];

  if (isLoading) {
    return <div className="p-8 text-warm-600">Loading...</div>;
  }

  return (
    <div className="h-full bg-warm-50 overflow-auto">
      <div className="max-w-2xl mx-auto py-8 px-4">
        <h1 className="text-2xl font-bold text-warm-900 mb-6">Todos</h1>

        {lists.length === 0 ? (
          <p className="text-warm-600">No todo lists yet.</p>
        ) : (
          <div className="space-y-6">
            {lists.map((list) => (
              <TodoListCard key={list.relativePath} list={list} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

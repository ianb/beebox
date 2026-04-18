/**
 * Todos page — view and manage todo lists.
 */

import { getEventSourceBase } from "../api";
import { trpc } from "../lib/trpc";
import { useSSE } from "../hooks/useSSE";
import { TodoListCard } from "../components/TodoListCard";
import { Column } from "../components/ui/Column";
import { Stack } from "../components/ui/Stack";
import { Text } from "../components/ui/Text";

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
    return <Text as="div" tone="subtle" className="p-8">Loading...</Text>;
  }

  return (
    <Column overflow="auto" className="h-full">
      <Stack gap="lg" className="max-w-2xl mx-auto py-8 px-4">
        <Text as="h1" size="2xl" weight="bold">Todos</Text>

        {lists.length === 0 ? (
          <Text as="p" tone="subtle">No todo lists yet.</Text>
        ) : (
          <Stack gap="lg">
            {lists.map((list) => (
              <TodoListCard key={list.relativePath} list={list} />
            ))}
          </Stack>
        )}
      </Stack>
    </Column>
  );
}

/**
 * TodoViewCard — card renderer for `todo-view` cards
 * (`docs/plans/todo-annotation.md` Track 4).
 *
 * A `todo-view` card is a live query, not authored content: its frontmatter
 * (`glob`/`status`/`assigned`) drives `trpc.todos.list`, and this component
 * renders whatever that query returns — grouped by plate-state, read-only
 * (no click-to-done in v1), each item linking to its source card at card
 * granularity (no line-anchored deep links yet).
 *
 * When the card's frontmatter omits `status`, the query defaults to `open`
 * (mirroring `cb todos`'s own default) — plate-state groups (escalated/
 * on-plate/quiet/parked) are about open todos; a card that explicitly wants
 * `done`/`dropped` in its scope gets those under their own group.
 */

import { useParams } from "@tanstack/react-router";
import { trpc } from "../lib/trpc";
import { href } from "../lib/routing";
import { Card } from "./ui/Card";
import { Text } from "./ui/Text";
import { Stack } from "./ui/Stack";
import { Row } from "./ui/Row";
import { Badge } from "./ui/Badge";
import { TextLink } from "./ui/TextLink";
import { FriendlyDate } from "./ui/FriendlyDate";
import { cbSource, cbSourceItem } from "../lib/source-tag";
import { isTodoStatus } from "@shared/todo-model";
import type { RendererProps } from "../renderers";
import type { RouterOutput } from "../lib/trpc";
import type { TodoStatus, TodoPlateState } from "@shared/todo-model";

type TodoListOutput = RouterOutput["todos"]["list"];
type CollectedTodo = TodoListOutput["todos"][number];
type TodoCollectionIssue = TodoListOutput["issues"][number];

const GROUP_ORDER: ReadonlyArray<{ state: TodoPlateState; label: string }> = [
  { state: "escalated", label: "Escalated" },
  { state: "on-plate", label: "On the plate" },
  { state: "quiet", label: "Quiet" },
  { state: "parked", label: "Parked" },
  { state: "done", label: "Done" },
  { state: "dropped", label: "Dropped" },
];

function stringField(fm: Record<string, unknown>, key: string): string | undefined {
  const value = fm[key];
  return typeof value === "string" ? value : undefined;
}

function statusListField(fm: Record<string, unknown>): TodoStatus[] | undefined {
  const value = fm["status"];
  if (!Array.isArray(value)) return undefined;
  const statuses = value.filter((v): v is TodoStatus => typeof v === "string" && isTodoStatus(v));
  return statuses.length > 0 ? statuses : undefined;
}

/** Stable React list key for one collected todo: card path + its locator (body line or frontmatter index). */
function todoKey(todo: CollectedTodo): string {
  return todo.locator.kind === "body"
    ? `${todo.path}:${String(todo.locator.line)}`
    : `${todo.path}#todos[${String(todo.locator.index)}]`;
}

function groupByPlateState(todos: CollectedTodo[]): Map<TodoPlateState, CollectedTodo[]> {
  const groups = new Map<TodoPlateState, CollectedTodo[]>();
  for (const todo of todos) {
    const bucket = groups.get(todo.plateState) ?? [];
    bucket.push(todo);
    groups.set(todo.plateState, bucket);
  }
  return groups;
}

function TodoRow({ todo, boxSlug }: { todo: CollectedTodo; boxSlug: string | undefined }) {
  const cardHref = boxSlug ? href(`/${boxSlug}/browse/${todo.path}`) : undefined;
  return (
    <div {...cbSourceItem(`todo: ${todo.text}`)}>
      <Row gap="sm" wrap>
        <Text size="sm">{todo.text}</Text>
        {todo.due !== undefined ? (
          <Badge size="sm" tone="warning" title="Due">
            due <FriendlyDate iso={todo.due} mode="date" />
          </Badge>
        ) : null}
        {todo.start !== undefined ? (
          <Badge size="sm" tone="info" title="Start">
            starts <FriendlyDate iso={todo.start} mode="date" />
          </Badge>
        ) : null}
        {todo.assigned !== undefined ? (
          <Badge size="sm" title="Assigned">{todo.assigned}</Badge>
        ) : null}
        {todo.id !== undefined ? (
          <Badge size="sm" tone="neutral" title="Todo id">#{todo.id}</Badge>
        ) : null}
      </Row>
      {cardHref ? (
        <TextLink to={cardHref} tone="subtle">
          <Text size="xs" tone="muted">{todo.path}</Text>
        </TextLink>
      ) : (
        <Text size="xs" tone="muted">{todo.path}</Text>
      )}
    </div>
  );
}

function IssuesSection({ issues }: { issues: TodoCollectionIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <Card padding="sm" background="warm" border="subtle">
      <Stack gap="xs">
        <Text size="xs" tone="muted" uppercase weight="semibold">
          {issues.length} card{issues.length !== 1 ? "s" : ""} couldn't be read
        </Text>
        {issues.map((issue) => (
          <Text key={`${issue.kind}:${issue.path}`} as="div" size="xs" tone="muted">
            {issue.path} — {issue.message}
          </Text>
        ))}
      </Stack>
    </Card>
  );
}

export function TodoViewCard({ data }: RendererProps) {
  const { boxSlug } = useParams({ strict: false });
  const fm = data.frontmatter ?? {};
  const glob = stringField(fm, "glob");
  const assigned = stringField(fm, "assigned");
  const status = statusListField(fm) ?? ["open"];

  const query = trpc.todos.list.useQuery({
    cardPath: data.path,
    ...(glob !== undefined && { glob }),
    status,
    ...(assigned !== undefined && { assigned }),
  });

  if (query.isLoading) {
    return <Text as="div" tone="subtle" className="p-8">Loading todos…</Text>;
  }
  if (query.data === undefined) {
    return <Text as="div" tone="subtle" className="p-8">Couldn't load todos.</Text>;
  }

  const { todos, issues, effectiveGlob } = query.data;
  const groups = groupByPlateState(todos);
  const title = stringField(fm, "title") ?? "Todos";

  return (
    <div className="p-4 max-w-2xl mx-auto" {...cbSource("card", data.path)}>
      <Card padding="md">
        <Stack gap="md">
          <Stack gap="none">
            <Text as="h2" size="lg" weight="bold">{title}</Text>
            <Text as="div" size="xs" tone="muted" mono>{effectiveGlob}</Text>
          </Stack>

          {todos.length === 0 ? (
            <Text as="div" tone="subtle">No open todos in scope.</Text>
          ) : (
            GROUP_ORDER.filter((g) => (groups.get(g.state)?.length ?? 0) > 0).map((g) => (
              <Stack key={g.state} gap="sm">
                <Text size="xs" tone="muted" uppercase weight="semibold">
                  {g.label} ({groups.get(g.state)?.length ?? 0})
                </Text>
                <Stack gap="sm">
                  {(groups.get(g.state) ?? []).map((todo) => (
                    <TodoRow key={todoKey(todo)} todo={todo} boxSlug={boxSlug} />
                  ))}
                </Stack>
              </Stack>
            ))
          )}

          <IssuesSection issues={issues} />
        </Stack>
      </Card>
    </div>
  );
}

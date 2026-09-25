/**
 * TodoViewCard — card renderer for `todo-view` cards
 * (`docs/plans/todo-collection.md`, Track 4).
 *
 * A `todo-view` card is a live query, not authored content: its own directory
 * is the query's `here`, its frontmatter supplies `glob`/`status`/`assigned`,
 * and this component renders whatever `collections.query` returns. Read-only
 * — checking a todo off is editing the card it was written in.
 *
 * Two controls change what is shown, and neither is a card field: grouping
 * and "show finished" are view state, so they ride in the URL, survive
 * navigation, and never rewrite somebody's card because they looked at it
 * differently for a minute.
 *
 * `place` is the default because in a working box almost nothing is dated:
 * the heading a todo sits under and the todo it nests beneath are what make
 * it mean anything. `plate` is there for the days when dates are the question.
 */

import { useCallback } from "react";
import { useParams } from "@tanstack/react-router";
import { trpc } from "../lib/trpc";
import { Card } from "./ui/Card";
import { Text } from "./ui/Text";
import { ErrorText } from "./ui/ErrorText";
import { StatusMessage } from "./ui/StatusMessage";
import { Heading } from "./ui/Heading";
import { Stack } from "./ui/Stack";
import { InlineAction } from "./ui/InlineAction";
import { bbxSource } from "../lib/source-tag";
import { busEventData } from "../lib/bus-events";
import { useBusSubscription, type RealtimeEvent } from "../hooks/useBusSubscription";
import { CardRow } from "./todo-view/CardRow";
import { DatedStrip } from "./todo-view/DatedStrip";
import {
  Controls,
  IssuesSection,
  optionsFrom,
  PlateHeadline,
  ScopeLine,
  type ViewOptions,
} from "./todo-view/TodoViewControls";
import {
  datedTodos,
  hereForCard,
  matchingItemCount,
  resolveTodoViewStatusFilter,
  statusFilterWithFinished,
  type TodoResult,
} from "./todo-view-card-logic";
import type { RendererProps } from "../file-type-registry";

function stringField(fm: Record<string, unknown>, key: string): string | undefined {
  const value = fm[key];
  return typeof value === "string" ? value : undefined;
}

function TodoViewBody({ data, result, agentCount, viewingAgent, options, onChange }: {
  data: RendererProps["data"];
  result: TodoResult;
  agentCount: number;
  viewingAgent: boolean;
  options: ViewOptions;
  onChange: (next: Partial<ViewOptions>) => void;
}) {
  const { boxSlug } = useParams({ strict: false });
  const fm = data.frontmatter ?? {};
  const title = stringField(fm, "title") ?? "Todos";
  const finished = result.reduction.done + result.reduction.dropped;
  const hasRows = result.groups.some((group) => group.rows.length > 0);

  return (
    <div className="p-4 max-w-2xl mx-auto" {...bbxSource("card", data.path)}>
      <Card padding="md">
        <Stack gap="md">
          <Stack gap="none">
            <Heading level={2}>{title}</Heading>
            <PlateHeadline result={result} agentCount={agentCount} viewingAgent={viewingAgent} onChange={onChange} />
            <ScopeLine result={result} />
          </Stack>

          <Controls options={options} onChange={onChange} />

          <DatedStrip dated={datedTodos(result)} boxSlug={boxSlug} />

          {hasRows ? null : <Text as="div" tone="subtle">No todos in scope.</Text>}

          {result.groups.map((group) => (
            <Stack key={group.key} gap="sm">
              {/* `place` is a single group whose label would only repeat the
                  control above it; `plate` names a real distinction. */}
              {options.group === "plate" ? (
                <Text size="xs" tone="muted" uppercase weight="semibold">
                  {group.label} ({group.reduction.open + group.reduction.parked + group.reduction.done + group.reduction.dropped})
                </Text>
              ) : null}
              {group.rows.map((row) => (
                <CardRow key={row.card.path} row={row} />
              ))}
            </Stack>
          ))}

          {/* A text button, not a switch: it reveals finished items in place
              (still view state in the URL) rather than a persistent control
              for a state the boxholder wants hidden by default. */}
          {options.showFinished || finished === 0 ? null : (
            <InlineAction
              id="bbx-todo-view-show-finished"
              intent="subtle"
              onClick={() => onChange({ showFinished: true })}
              title={`Show ${finished} finished todo${finished === 1 ? "" : "s"}`}
            >
              {finished} done
            </InlineAction>
          )}

          <IssuesSection issues={result.issues} />
        </Stack>
      </Card>
    </div>
  );
}

export function TodoViewCard(props: RendererProps) {
  const { data, viewState, onViewStateChange } = props;
  const fm = data.frontmatter ?? {};
  const glob = stringField(fm, "glob");
  const assigned = stringField(fm, "assigned");
  const options = optionsFrom(viewState);
  const here = hereForCard(data.path);

  // A card that already commits its own `assigned` filter (an "agent-only"
  // instance, say) has no boxholder/agent slice to toggle between — the
  // headline and the agent-follow-up count only make sense for the common
  // case, a card with no `assigned` field of its own.
  const showHeadline = assigned === undefined;
  const viewingAgent = showHeadline && options.assignedView === "agent";
  const scopeParams: { scope: "boxholder" | "all"; assigned?: string } = viewingAgent
    ? { scope: "all", assigned: "agent" }
    : assigned !== undefined
      ? { scope: "all", assigned }
      : { scope: "boxholder" };

  const utils = trpc.useUtils();
  const query = trpc.collections.query.useQuery({
    collection: "todos",
    query: {
      here,
      ...(glob !== undefined && { glob }),
      group: options.group,
      params: {
        status: statusFilterWithFinished(resolveTodoViewStatusFilter(fm), options.showFinished),
        ...scopeParams,
      },
    },
  });

  // The headline's third number. A `scope: "all"` query's OWN reduction can't
  // answer it — a reduction counts everything `scope` admitted, not what
  // `assigned` narrows to (`matches` decides display, not reduction) — so
  // this is a second, cheap, `assigned`-only query, read through
  // `matchingItemCount`. Skipped entirely once viewing the agent's own slice,
  // since the main query already answers that.
  const agentQuery = trpc.collections.query.useQuery(
    {
      collection: "todos",
      query: {
        here,
        ...(glob !== undefined && { glob }),
        includeReferring: false,
        params: { status: ["open"], scope: "all", assigned: "agent" },
      },
    },
    { enabled: showHeadline && !viewingAgent },
  );
  const agentCount = agentQuery.data === undefined ? 0 : matchingItemCount(agentQuery.data);

  // A todo lives in an ordinary card, so any card edit can change this list.
  // The scope is a glob rather than one path, so every `.card` write counts.
  useBusSubscription({
    onEvent: useCallback(
      (event: RealtimeEvent) => {
        const change = busEventData(event, "file-change");
        if (!change || !change.path.endsWith(".card")) return;
        void utils.collections.query.invalidate();
      },
      [utils],
    ),
  });

  const change = (next: Partial<ViewOptions>): void => {
    onViewStateChange?.({ ...options, ...next }, "replace");
  };

  if (query.isLoading) return <StatusMessage>Loading todos…</StatusMessage>;
  if (query.error !== null) return <ErrorText className="p-8">Couldn&rsquo;t load todos: {query.error.message}</ErrorText>;
  if (query.data === undefined) return <ErrorText className="p-8">Couldn&rsquo;t load todos.</ErrorText>;

  return (
    <TodoViewBody
      data={data}
      result={query.data}
      agentCount={agentCount}
      viewingAgent={viewingAgent}
      options={options}
      onChange={change}
    />
  );
}

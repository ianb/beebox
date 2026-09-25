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
import { Row } from "./ui/Row";
import { Toggle } from "./ui/Toggle";
import { TabBar } from "./ui/TabBar";
import { bbxSource } from "../lib/source-tag";
import { busEventData } from "../lib/bus-events";
import { useBusSubscription, type RealtimeEvent } from "../hooks/useBusSubscription";
import { CardRow } from "./todo-view/CardRow";
import { DatedStrip } from "./todo-view/DatedStrip";
import {
  datedTodos,
  hereForCard,
  resolveTodoViewStatusFilter,
  statusFilterWithFinished,
  type TodoResult,
} from "./todo-view-card-logic";
import type { RendererProps } from "../file-type-registry";

type Grouping = "place" | "plate";

function stringField(fm: Record<string, unknown>, key: string): string | undefined {
  const value = fm[key];
  return typeof value === "string" ? value : undefined;
}

interface ViewOptions {
  group: Grouping;
  showFinished: boolean;
}

function optionsFrom(viewState: RendererProps["viewState"]): ViewOptions {
  const view = viewState ?? {};
  return {
    group: view["group"] === "plate" ? "plate" : "place",
    showFinished: view["showFinished"] === true,
  };
}

function ScopeLine({ result }: { result: TodoResult }) {
  const { here, glob, includeReferring } = result.query;
  const place = here === "" ? "the whole box" : here;
  const scope = glob === `${here}/**` || (here === "" && glob === "**/*.card") ? place : `${place} (${glob})`;
  return (
    <Text as="div" size="xs" tone="muted">
      Scope: {scope}
      {includeReferring ? ", plus todos elsewhere that link here" : null}
    </Text>
  );
}

function IssuesSection({ issues }: { issues: TodoResult["issues"] }) {
  if (issues.length === 0) return null;
  return (
    <Card padding="sm" background="warm" border="subtle">
      <Stack gap="xs">
        <Text size="xs" tone="muted" uppercase weight="semibold">
          {issues.length} card{issues.length === 1 ? "" : "s"} couldn&rsquo;t be read
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

function Controls({ options, onChange }: { options: ViewOptions; onChange: (next: Partial<ViewOptions>) => void }) {
  return (
    <Row gap="md" align="center" justify="between" wrap>
      <TabBar
        idPrefix="bbx-todo-view-group"
        label="Group todos by"
        value={options.group}
        onChange={(group: Grouping) => onChange({ group })}
        tabs={[
          { value: "place", label: "By place" },
          { value: "plate", label: "By date" },
        ]}
      />
      <Toggle
        id="bbx-todo-view-show-finished"
        checked={options.showFinished}
        onChange={(showFinished) => onChange({ showFinished })}
        label="Show finished"
      />
    </Row>
  );
}

function TodoViewBody({ data, result, options, onChange }: {
  data: RendererProps["data"];
  result: TodoResult;
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

          {options.showFinished || finished === 0 ? null : (
            <Text as="div" size="xs" tone="muted">
              {finished} finished todo{finished === 1 ? "" : "s"} hidden.
            </Text>
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

  const utils = trpc.useUtils();
  const query = trpc.collections.query.useQuery({
    collection: "todos",
    query: {
      here: hereForCard(data.path),
      ...(glob !== undefined && { glob }),
      group: options.group,
      params: {
        status: statusFilterWithFinished(resolveTodoViewStatusFilter(fm), options.showFinished),
        ...(assigned !== undefined && { assigned }),
      },
    },
  });

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

  return <TodoViewBody data={data} result={query.data} options={options} onChange={change} />;
}

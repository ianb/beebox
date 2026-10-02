/**
 * `TodoViewCard`'s view-state shape and the small controls/headline pieces
 * that read it — split out to keep `TodoViewCard.tsx` under the file-size
 * budget (`docs/plans/todo-collection.md`, Track 4; the headline is Track 1).
 */

import { Card } from "../ui/Card";
import { Text } from "../ui/Text";
import { Stack } from "../ui/Stack";
import { Row } from "../ui/Row";
import { InlineAction } from "../ui/InlineAction";
import { TabBar } from "../ui/TabBar";
import { plateHeadline, type TodoResult } from "../todo-view-card-logic";
import type { RendererProps } from "../../file-type-registry";

export type Grouping = "place" | "plate";
/**
 * Which slice of `assigned` this render is showing. `boxholder` is the
 * default every card with no `assigned` field starts on; `agent` is what "K
 * for the agent" toggles to, in place — a card that DOES set `assigned`
 * commits to one slice and never offers the toggle (see `TodoViewCard.tsx`'s
 * `showHeadline`).
 */
export type AssignedView = "boxholder" | "agent";

export interface ViewOptions {
  group: Grouping;
  showFinished: boolean;
  assignedView: AssignedView;
}

export function optionsFrom(viewState: RendererProps["viewState"]): ViewOptions {
  const view = viewState ?? {};
  return {
    group: view["group"] === "plate" ? "plate" : "place",
    showFinished: view["showFinished"] === true,
    assignedView: view["assignedView"] === "agent" ? "agent" : "boxholder",
  };
}

export function ScopeLine({ result }: { result: TodoResult }) {
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

export function IssuesSection({ issues }: { issues: TodoResult["issues"] }) {
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

export function Controls({ options, onChange }: { options: ViewOptions; onChange: (next: Partial<ViewOptions>) => void }) {
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
    </Row>
  );
}

/**
 * "15 on your plate · 4 later · 3 for the agent" — the reduction's own
 * numbers, so the first one is the nav badge's number by construction. "for
 * the agent" toggles `assignedView` in place, in the URL like every other
 * view control; while viewing the agent's own slice the headline names that
 * and offers the way back, rather than showing plate numbers that would no
 * longer describe what the list below is showing.
 */
export function PlateHeadline({ result, agentCount, viewingAgent, onChange }: {
  result: TodoResult;
  agentCount: number;
  viewingAgent: boolean;
  onChange: (next: Partial<ViewOptions>) => void;
}) {
  if (viewingAgent) {
    return (
      <Row gap="xs" wrap align="baseline">
        <Text as="span" weight="semibold">Agent follow-ups</Text>
        <InlineAction id="bbx-todo-view-back-to-plate" intent="subtle" onClick={() => onChange({ assignedView: "boxholder" })}>
          back to your plate
        </InlineAction>
      </Row>
    );
  }
  const { onPlate, later } = plateHeadline(result.reduction);
  return (
    <Row gap="xs" wrap align="baseline">
      <Text as="span" weight="semibold">{onPlate} on your plate</Text>
      <Text as="span" tone="muted">· {later} later</Text>
      {agentCount > 0 ? (
        <InlineAction id="bbx-todo-view-for-the-agent" intent="subtle" onClick={() => onChange({ assignedView: "agent" })}>
          · {agentCount} for the agent
        </InlineAction>
      ) : null}
    </Row>
  );
}

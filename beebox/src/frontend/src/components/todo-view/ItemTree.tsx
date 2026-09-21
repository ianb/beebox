/**
 * One todo, and whatever nests under it, inside a `todo-view` list
 * (`docs/plans/todo-collection.md`, Track 4).
 *
 * The item reads the same here as it does in the card it was written in: the
 * status treatment comes from `components/Todo.tsx`, so a done item is struck
 * through and a parked one dimmed in both places rather than by two rules
 * that can drift.
 *
 * An item marked `matching: false` is an ancestor the filter would otherwise
 * have orphaned. It is shown as context — muted, unmarked — so its open child
 * reads under the thing it belongs to.
 */

import { useState } from "react";
import { Badge } from "../ui/Badge";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { InlineAction } from "../ui/InlineAction";
import { FriendlyDate } from "../ui/FriendlyDate";
import { STATUS_TEXT_CLASS } from "../Todo";
import { bbxSourceItem } from "../../lib/source-tag";
import { clampAnnotation, needsExpand, todoKey, type TodoNode } from "../todo-view-card-logic";

function Annotation({ annotation }: { annotation: string }) {
  const [expanded, setExpanded] = useState(false);
  const expandable = needsExpand(annotation);
  return (
    <Text as="div" size="xs" tone="muted">
      {expandable && !expanded ? clampAnnotation(annotation) : annotation}
      {/* No `bbx-` id: a list renders one of these per annotated todo, and a
          duplicate address breaks `getElementById` for every other control on
          the page (lib/ui-scan/scan.ts). The two controls that address the
          list as a whole carry ids instead. */}
      {expandable ? (
        <InlineAction
          intent="subtle"
          className="ml-1"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "less" : "more"}
        </InlineAction>
      ) : null}
    </Text>
  );
}

function Chips({ item }: { item: TodoNode["item"] }) {
  return (
    <>
      {item.due === undefined ? null : (
        <Badge size="sm" tone="warning" title="Due">
          due <FriendlyDate iso={item.due} mode="date" />
        </Badge>
      )}
      {item.start === undefined ? null : (
        <Badge size="sm" tone="info" title="Start">
          starts <FriendlyDate iso={item.start} mode="date" />
        </Badge>
      )}
      {item.assigned === undefined ? null : (
        <Badge size="sm" title="Assigned">{item.assigned}</Badge>
      )}
    </>
  );
}

function ItemLine({ node }: { node: TodoNode }) {
  const { item } = node;
  return (
    <Stack gap="none" {...bbxSourceItem(`todo: ${item.text}`)}>
      <Row gap="sm" wrap align="baseline">
        <span className={item.matching ? STATUS_TEXT_CLASS[item.status] : "text-warm-400"}>
          <Text size="sm" as="span">{item.text}</Text>
        </span>
        {item.matching ? <Chips item={item} /> : null}
      </Row>
      {item.annotation === "" ? null : <Annotation annotation={item.annotation} />}
    </Stack>
  );
}

/**
 * A forest of todos. Depth is expressed by nesting rather than by a computed
 * indent, so an item three levels down needs no depth arithmetic and no cap.
 */
export function ItemTree({ nodes }: { nodes: TodoNode[] }) {
  return (
    <Stack gap="xs">
      {nodes.map((node) => (
        <Stack key={todoKey(node.item)} gap="xs">
          <ItemLine node={node} />
          {node.children.length === 0 ? null : (
            <div className="border-l border-warm-200 pl-3 ml-1">
              <ItemTree nodes={node.children} />
            </div>
          )}
        </Stack>
      ))}
    </Stack>
  );
}

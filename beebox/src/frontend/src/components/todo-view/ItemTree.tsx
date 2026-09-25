/**
 * One todo, and whatever nests under it, inside a `todo-view` list
 * (`docs/plans/todo-collection.md`, Track 4).
 *
 * The item reads the same here as it does in the card it was written in: both
 * render through `todo/TodoItem.tsx` (`docs/plans/todos-ui.md`, Track 2), so
 * a done item is struck through, a parked one dimmed, and an overdue one
 * flagged by one rule rather than by several that can drift.
 *
 * An item marked `matching: false` is an ancestor the filter would otherwise
 * have orphaned. It is shown as context — muted, unmarked — so its open child
 * reads under the thing it belongs to.
 */

import { useState } from "react";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { InlineAction } from "../ui/InlineAction";
import { TodoItem } from "../todo/TodoItem";
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

function ItemLine({ node }: { node: TodoNode }) {
  const { item } = node;
  return (
    <Stack gap="none" {...bbxSourceItem(`todo: ${item.text}`)}>
      <TodoItem
        status={item.status}
        assigned={item.assigned}
        due={item.due}
        start={item.start}
        plateState={item.plateState}
        layout="line"
        locator={item.locator}
        muted={!item.matching}
      >
        {item.text}
      </TodoItem>
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

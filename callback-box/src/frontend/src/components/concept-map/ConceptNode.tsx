/**
 * Custom React Flow node for a concept: a kind-tinted box showing the name, the
 * KC kind, and a misconception indicator. The gloss is the hover title; full
 * detail (gloss, misconceptions, depth) opens in the side panel on click.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { conceptOf, KIND_META } from "./concept-data";
import { cn } from "../../lib/cn";
import { Text } from "../ui/Text";
import { Badge } from "../ui/Badge";

/** Small exclamation-triangle, inheriting the badge's color via currentColor. */
export function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

export function ConceptNode({ data, selected }: NodeProps) {
  const concept = conceptOf(data);
  const meta = KIND_META[concept.kind];
  const misCount = concept.misconceptions.length;

  return (
    <div
      className={cn(
        "w-[210px] rounded-lg border px-3 py-2 shadow-sm",
        meta.nodeClass,
        selected ? "ring-2 ring-primary" : null,
      )}
      title={concept.gloss ?? undefined}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-start justify-between gap-2">
        <Text size="sm" weight="semibold" tone="strong">
          {concept.name}
        </Text>
        {misCount > 0 ? (
          <Badge
            tone="warning"
            size="sm"
            title={`${String(misCount)} common misconception${misCount === 1 ? "" : "s"} — click for detail`}
          >
            <span className="inline-flex items-center gap-0.5">
              <WarningIcon />
              {misCount}
            </span>
          </Badge>
        ) : null}
      </div>
      <Text size="xs" tone="muted">
        {meta.label}
      </Text>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

/**
 * Custom React Flow node for a concept: a kind-tinted box showing the name, the
 * KC kind, and a misconception indicator. The gloss is the hover title; full
 * detail (gloss, misconceptions, depth) opens in the side panel on click.
 */

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { KIND_META } from "../concept-data.js";
import type { ConceptFlowNode } from "./model.js";

/** Small exclamation-triangle, inheriting the badge's color via currentColor. */
export function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="bbx-cm-icon" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

export function ConceptNode({ data, selected }: NodeProps<ConceptFlowNode>) {
  const { concept } = data;
  const meta = KIND_META[concept.kind];
  const misCount = concept.misconceptions.length;
  const className = ["bbx-cm-node", meta.className, selected ? "bbx-cm-node-selected" : ""].join(" ").trim();

  return (
    <div className={className} title={concept.gloss ?? undefined}>
      <Handle type="target" position={Position.Top} />
      <div className="bbx-cm-node-head">
        <span className="bbx-cm-node-name">{concept.name}</span>
        {misCount > 0 ? (
          <span
            className="bbx-cm-badge"
            title={`${String(misCount)} common misconception${misCount === 1 ? "" : "s"} — click for detail`}
          >
            <WarningIcon />
            {misCount}
          </span>
        ) : null}
      </div>
      <span className="bbx-cm-muted">{meta.label}</span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

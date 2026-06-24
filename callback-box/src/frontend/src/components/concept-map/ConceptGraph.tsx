/**
 * The concept-map graph view (code-split — this module pulls in React Flow +
 * dagre, so it's lazy-loaded by ConceptMapView and never reaches the main
 * bundle). Lays the typed graph out top-down, with a legend and a click-to-open
 * detail panel.
 */

import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";
import { Background, Controls, ReactFlow, type Node } from "@xyflow/react";
import { buildGraph } from "./graph-model";
import { ConceptNode } from "./ConceptNode";
import {
  EDGE_META,
  EDGE_ORDER,
  KIND_META,
  KIND_ORDER,
  type ParsedConcept,
} from "./concept-data";
import { cn } from "../../lib/cn";
import { Card } from "../ui/Card";
import { Text } from "../ui/Text";
import { CloseButton } from "../ui/CloseButton";

const nodeTypes = { concept: ConceptNode };

export default function ConceptGraph({ concepts }: { concepts: ParsedConcept[] }) {
  // useMemo: React Flow re-runs layout when the nodes/edges identity changes, so
  // the built graph must stay stable across renders (it depends only on
  // `concepts`, which the parent memoizes).
  const { nodes, edges } = useMemo(() => buildGraph(concepts), [concepts]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = concepts.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="relative w-full h-[34rem] rounded-lg border border-warm-200 overflow-hidden bg-warm-50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        onNodeClick={(_e, node: Node) => setSelectedId(node.id)}
        onPaneClick={() => setSelectedId(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
      <Legend />
      {selected !== null ? <DetailPanel concept={selected} onClose={() => setSelectedId(null)} /> : null}
    </div>
  );
}

function Legend() {
  return (
    <Card padding="sm" className="absolute bottom-3 left-3 max-w-[15rem] pointer-events-none opacity-95">
      <Text size="xs" weight="semibold" tone="muted" as="div">
        Concept kinds
      </Text>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {KIND_ORDER.map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className={cn("w-2.5 h-2.5 rounded-full", KIND_META[k].dotClass)} />
            <Text size="xs" tone="muted">
              {KIND_META[k].label}
            </Text>
          </span>
        ))}
      </div>
      <Text size="xs" weight="semibold" tone="muted" as="div" className="mt-2">
        Relations
      </Text>
      <div className="mt-1 flex flex-col gap-0.5">
        {EDGE_ORDER.map((e) => (
          <span key={e} className="inline-flex items-center gap-1.5">
            <span
              className={cn("w-5 border-t-2", EDGE_META[e].textClass, EDGE_META[e].dashed ? "border-dashed" : "border-solid")}
              style={{ borderTopColor: "currentColor" }}
            />
            <Text size="xs" tone="muted">
              {EDGE_META[e].label}
            </Text>
          </span>
        ))}
      </div>
    </Card>
  );
}

function DetailPanel({ concept, onClose }: { concept: ParsedConcept; onClose: () => void }) {
  const meta = KIND_META[concept.kind];
  return (
    <Card padding="md" className="absolute top-3 right-3 w-72 max-h-[calc(100%-1.5rem)] overflow-auto shadow-md">
      <div className="flex items-start justify-between gap-2">
        <Text size="lg" weight="semibold" tone="strong" as="div">
          {concept.name}
        </Text>
        <CloseButton onClick={onClose} label="Close concept detail" />
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className={cn("w-2.5 h-2.5 rounded-full", meta.dotClass)} />
        <Text size="xs" tone="muted">
          {meta.label}
          {concept.depth !== null ? ` · ${concept.depth}` : ""}
        </Text>
      </div>
      {concept.gloss !== null ? (
        <Text size="sm" as="p" className="mt-2">
          {concept.gloss}
        </Text>
      ) : null}
      {concept.misconceptions.length > 0 ? (
        <div className="mt-3">
          <Text size="xs" weight="semibold" tone="danger" as="div">
            Common misconceptions
          </Text>
          <ul className="mt-1 list-disc pl-4">
            {concept.misconceptions.map((m) => (
              <li key={m}>
                <Text size="sm" tone="muted">
                  {m}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * The concept-map graph view (code-split — this module pulls in React Flow +
 * dagre, so it's lazy-loaded by ConceptMapView and never reaches the main
 * bundle). Lays the typed graph out top-down, with a legend and a click-to-open
 * detail panel.
 */

import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState } from "react";
import { Background, Controls, ReactFlow, type Node } from "@xyflow/react";
import { buildGraph } from "./graph-model";
import { ConceptNode, WarningIcon } from "./ConceptNode";
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
import { Badge } from "../ui/Badge";
import { CloseButton } from "../ui/CloseButton";

const nodeTypes = { concept: ConceptNode };

export default function ConceptGraph({ concepts }: { concepts: ParsedConcept[] }) {
  // useMemo: React Flow re-runs layout when the nodes/edges identity changes, so
  // the built graph must stay stable across renders (it depends only on
  // `concepts`, which the parent memoizes).
  const { nodes, edges } = useMemo(() => buildGraph(concepts), [concepts]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const selected = concepts.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  return (
    <div
      className={cn(
        "rounded-lg border border-warm-200 overflow-hidden bg-warm-50",
        fullscreen ? "fixed inset-0 z-50 rounded-none" : "relative w-full h-[80vh] min-h-[30rem]",
      )}
    >
      <ReactFlow
        // Re-mount on fullscreen toggle so fitView re-fits to the new size.
        key={fullscreen ? "fs" : "inline"}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.15}
        onNodeClick={(_e, node: Node) => setSelectedId(node.id)}
        onPaneClick={() => setSelectedId(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      <FullscreenToggle fullscreen={fullscreen} onToggle={() => setFullscreen((v) => !v)} />
      <Legend />
      {selected !== null ? <DetailPanel concept={selected} onClose={() => setSelectedId(null)} /> : null}
    </div>
  );
}

/** Expand/collapse the graph to fill the whole page. */
function FullscreenToggle({ fullscreen, onToggle }: { fullscreen: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={fullscreen ? "Exit full screen" : "Expand graph to full screen"}
      title={fullscreen ? "Exit full screen (Esc)" : "Expand to full screen"}
      className="absolute top-3 left-3 z-10 rounded-md border border-warm-200 bg-white p-1.5 text-warm-600 shadow-sm hover:bg-warm-100"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4" aria-hidden="true">
        {fullscreen ? (
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 4v5H4m11-5v5h5M9 20v-5H4m11 5v-5h5" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        )}
      </svg>
    </button>
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
      <div className="mt-2 inline-flex items-center gap-1.5">
        <Badge tone="warning" size="sm">
          <span className="inline-flex items-center gap-0.5">
            <WarningIcon />n
          </span>
        </Badge>
        <Text size="xs" tone="muted">common misconceptions</Text>
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

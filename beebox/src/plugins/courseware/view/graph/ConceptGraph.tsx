/**
 * The concept-map graph: the typed graph laid out top-down, with a legend, a
 * full-screen toggle, and a click-to-open detail panel. React Flow's stylesheet
 * and the plugin's own are imported here; the plugin build inlines both into
 * the bundle as a `<style>` element.
 */

import "@xyflow/react/dist/style.css";
import "./concept-map.css";
import { useMemo, useState, type KeyboardEvent } from "react";
import { Background, Controls, ReactFlow } from "@xyflow/react";
import { buildGraph } from "./model.js";
import { ConceptNode, WarningIcon } from "./ConceptNode.js";
import {
  EDGE_META,
  EDGE_ORDER,
  KIND_META,
  KIND_ORDER,
  type ParsedConcept,
} from "../concept-data.js";

const nodeTypes = { concept: ConceptNode };

export function ConceptGraph({ concepts }: { concepts: ParsedConcept[] }) {
  // useMemo: React Flow re-runs layout when the nodes/edges identity changes, so
  // the built graph must stay stable across renders (it depends only on
  // `concepts`, which the parent memoizes).
  const { nodes, edges } = useMemo(() => buildGraph(concepts), [concepts]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const selected = concepts.find((c) => c.id === selectedId) ?? null;

  // Escape leaves full screen. Listened on the frame (which fills the page in
  // full screen, and holds focus after the toggle click) rather than `window`,
  // so this module needs no DOM globals and stays typecheckable without the
  // DOM lib.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (fullscreen && e.key === "Escape") setFullscreen(false);
  };

  return (
    <div className={fullscreen ? "bbx-cm-frame bbx-cm-frame-fullscreen" : "bbx-cm-frame"} onKeyDown={onKeyDown}>
      <ReactFlow
        // Re-mount on fullscreen toggle so fitView re-fits to the new size.
        key={fullscreen ? "fs" : "inline"}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.15}
        onNodeClick={(_e, node) => setSelectedId(node.id)}
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
      className="bbx-cm-fullscreen-toggle"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="bbx-cm-icon-md" aria-hidden="true">
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
    <div className="bbx-cm-panel bbx-cm-legend">
      <div className="bbx-cm-legend-title">Concept kinds</div>
      <div className="bbx-cm-legend-kinds">
        {KIND_ORDER.map((k) => (
          <span key={k} className="bbx-cm-legend-item">
            <span className={`bbx-cm-dot ${KIND_META[k].className}`} />
            <span className="bbx-cm-muted">{KIND_META[k].label}</span>
          </span>
        ))}
      </div>
      <div className="bbx-cm-legend-title bbx-cm-legend-title-spaced">Relations</div>
      <div className="bbx-cm-legend-relations">
        {EDGE_ORDER.map((e) => (
          <span key={e} className="bbx-cm-legend-item">
            <span
              className={`bbx-cm-legend-line ${EDGE_META[e].className} ${EDGE_META[e].dashed ? "bbx-cm-dashed" : ""}`}
            />
            <span className="bbx-cm-muted">{EDGE_META[e].label}</span>
          </span>
        ))}
      </div>
      <div className="bbx-cm-legend-item bbx-cm-legend-title-spaced">
        <span className="bbx-cm-badge">
          <WarningIcon />n
        </span>
        <span className="bbx-cm-muted">common misconceptions</span>
      </div>
    </div>
  );
}

function DetailPanel({ concept, onClose }: { concept: ParsedConcept; onClose: () => void }) {
  const meta = KIND_META[concept.kind];
  return (
    <div className="bbx-cm-panel bbx-cm-detail">
      <div className="bbx-cm-detail-head">
        <div className="bbx-cm-detail-name">{concept.name}</div>
        <button type="button" onClick={onClose} aria-label="Close concept detail" className="bbx-cm-close">
          ×
        </button>
      </div>
      <div className="bbx-cm-legend-item">
        <span className={`bbx-cm-dot ${meta.className}`} />
        <span className="bbx-cm-muted">
          {meta.label}
          {concept.depth !== null ? ` · ${concept.depth}` : ""}
        </span>
      </div>
      {concept.gloss !== null ? <p className="bbx-cm-detail-gloss">{concept.gloss}</p> : null}
      {concept.misconceptions.length > 0 ? (
        <div className="bbx-cm-detail-misconceptions">
          <div className="bbx-cm-detail-misconceptions-title">Common misconceptions</div>
          <ul>
            {concept.misconceptions.map((m) => (
              <li key={m} className="bbx-cm-muted">
                {m}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

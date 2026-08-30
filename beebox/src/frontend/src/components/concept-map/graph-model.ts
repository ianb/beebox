/**
 * Builds React Flow nodes + edges from parsed concepts, laid out top-down with
 * dagre (the `prerequisite`/relation edges drive the layering; dagre breaks the
 * deliberate `complements` cycles automatically). Imports the graph libs, so it
 * lives in the code-split chunk with ConceptGraph — never reached from the main
 * bundle.
 */

import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";
import { EDGE_META, type ParsedConcept } from "./concept-data";

const NODE_W = 210;
const NODE_H = 66;

export interface BuiltGraph {
  nodes: Node[];
  edges: Edge[];
}

export function buildGraph(concepts: ParsedConcept[]): BuiltGraph {
  const ids = new Set(concepts.map((c) => c.id));

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: 70, nodesep: 45, marginx: 12, marginy: 12 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const c of concepts) g.setNode(c.id, { width: NODE_W, height: NODE_H });

  const edges: Edge[] = [];
  for (const c of concepts) {
    for (const rel of c.related) {
      if (!ids.has(rel.to)) continue; // dangling edge — card-lint warns separately
      g.setEdge(c.id, rel.to);
      const meta = EDGE_META[rel.kind];
      edges.push({
        id: `${c.id}__${rel.kind}__${rel.to}`,
        source: c.id,
        target: rel.to,
        className: meta.textClass,
        style: {
          stroke: "currentColor",
          strokeWidth: 1.5,
          ...(meta.dashed ? { strokeDasharray: "6 4" } : {}),
        },
      });
    }
  }

  dagre.layout(g);

  const nodes: Node[] = concepts.map((c) => {
    const laid = g.node(c.id);
    return {
      id: c.id,
      type: "concept",
      position: { x: laid.x - NODE_W / 2, y: laid.y - NODE_H / 2 },
      data: { concept: c },
    };
  });

  return { nodes, edges };
}

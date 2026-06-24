/**
 * Pure data + style layer for the concept-map renderer: parse the card's raw
 * `concepts` frontmatter into typed nodes, plus the kind/edge style metadata.
 *
 * No graph-lib import here on purpose — `ConceptMapView` imports this to decide
 * the empty state without pulling React Flow into the main bundle (the graph
 * itself is code-split; see ConceptGraph).
 */

export type KcKind = "fact" | "concept" | "procedure" | "principle";
export type EdgeKind =
  | "prerequisite"
  | "complements"
  | "contrasts-with"
  | "applied-in"
  | "commonly-confused-with";

const KC_KINDS: readonly KcKind[] = ["fact", "concept", "procedure", "principle"];
const EDGE_KINDS: readonly EdgeKind[] = [
  "prerequisite",
  "complements",
  "contrasts-with",
  "applied-in",
  "commonly-confused-with",
];

export interface ParsedRelation {
  to: string;
  kind: EdgeKind;
}

export interface ParsedConcept {
  id: string;
  name: string;
  kind: KcKind;
  gloss: string | null;
  depth: string | null;
  misconceptions: string[];
  related: ParsedRelation[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  // Frontmatter parse boundary: a plain YAML object arrives untyped.
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asKcKind(value: unknown): KcKind {
  return KC_KINDS.includes(value as KcKind) ? (value as KcKind) : "concept";
}

function asEdgeKind(value: unknown): EdgeKind | null {
  return EDGE_KINDS.includes(value as EdgeKind) ? (value as EdgeKind) : null;
}

/**
 * Parse the raw `concepts` frontmatter array into typed nodes. Defensive — the
 * frontmatter is untyped and may have drifted; bad entries are skipped, and an
 * unknown `kind` falls back to `concept` rather than dropping the node.
 */
export function parseConcepts(raw: unknown): ParsedConcept[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedConcept[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (rec === null) continue;
    const id = asString(rec["id"]);
    const name = asString(rec["name"]);
    if (id === null || name === null) continue;

    const related: ParsedRelation[] = [];
    if (Array.isArray(rec["related"])) {
      for (const r of rec["related"]) {
        const rr = asRecord(r);
        if (rr === null) continue;
        const to = asString(rr["to"]);
        const kind = asEdgeKind(rr["kind"]);
        if (to !== null && kind !== null) related.push({ to, kind });
      }
    }

    const misconceptions = Array.isArray(rec["misconceptions"])
      ? rec["misconceptions"].filter((m): m is string => typeof m === "string")
      : [];

    out.push({
      id,
      name,
      kind: asKcKind(rec["kind"]),
      gloss: asString(rec["gloss"]),
      depth: asString(rec["depth"]),
      misconceptions,
      related,
    });
  }
  return out;
}

/** Per-KC-kind styling: node tint (border + fill) and a legend dot. */
export const KIND_META: Record<KcKind, { label: string; nodeClass: string; dotClass: string }> = {
  principle: { label: "principle", nodeClass: "border-primary bg-primary-50", dotClass: "bg-primary" },
  concept: { label: "concept", nodeClass: "border-accent bg-accent-50", dotClass: "bg-accent" },
  procedure: { label: "procedure", nodeClass: "border-success bg-success-50", dotClass: "bg-success" },
  fact: { label: "fact", nodeClass: "border-info bg-info-50", dotClass: "bg-info" },
};

/** Display order for the legend. */
export const KIND_ORDER: readonly KcKind[] = ["principle", "concept", "procedure", "fact"];

/**
 * Per-edge-kind styling. Color is applied as a text color on the edge group and
 * the path strokes `currentColor` (the codebase's SVG idiom). `complements` and
 * `commonly-confused-with` are dashed; `complements` is the symmetric spiral.
 */
export const EDGE_META: Record<EdgeKind, { label: string; textClass: string; dashed: boolean }> = {
  prerequisite: { label: "prerequisite", textClass: "text-warm-500", dashed: false },
  complements: { label: "complements", textClass: "text-accent", dashed: true },
  "contrasts-with": { label: "contrasts with", textClass: "text-warning", dashed: false },
  "applied-in": { label: "applied in", textClass: "text-info", dashed: false },
  "commonly-confused-with": { label: "commonly confused with", textClass: "text-danger", dashed: true },
};

export const EDGE_ORDER: readonly EdgeKind[] = [
  "prerequisite",
  "complements",
  "contrasts-with",
  "applied-in",
  "commonly-confused-with",
];

/**
 * Read the `ParsedConcept` back out of a React Flow node's `data`. Centralizes
 * the one boundary cast — RF types node data as `Record<string, unknown>`, but
 * we always store `{ concept }` (see graph-model), so this is sound.
 */
export function conceptOf(data: Record<string, unknown>): ParsedConcept {
  return data["concept"] as ParsedConcept;
}

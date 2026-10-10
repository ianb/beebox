/**
 * Pure data + style layer for the concept-map view: parse the card's raw
 * `concepts` frontmatter into typed nodes, plus the kind/edge style metadata.
 *
 * No graph-lib import here on purpose: `view.tsx` decides the empty state from
 * this module alone, and the doctest exercises the parse without React Flow.
 * The plugin may not import engine internals, so the record guard is local.
 */

export type KcKind = "fact" | "concept" | "procedure" | "principle";
export type EdgeKind =
  | "prerequisite"
  | "complements"
  | "contrasts-with"
  | "applied-in"
  | "commonly-confused-with";

const KC_KIND_SET: ReadonlySet<string> = new Set<KcKind>([
  "fact",
  "concept",
  "procedure",
  "principle",
]);
const EDGE_KIND_SET: ReadonlySet<string> = new Set<EdgeKind>([
  "prerequisite",
  "complements",
  "contrasts-with",
  "applied-in",
  "commonly-confused-with",
]);

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

// Frontmatter parse boundary: a plain YAML object arrives untyped.
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) out[key] = entry;
  return out;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// Real membership guards: a string present in the kind set genuinely IS that
// literal-union member, so the predicate is sound without a cast.
function isKcKind(value: unknown): value is KcKind {
  return typeof value === "string" && KC_KIND_SET.has(value);
}

function isEdgeKind(value: unknown): value is EdgeKind {
  return typeof value === "string" && EDGE_KIND_SET.has(value);
}

function asKcKind(value: unknown): KcKind {
  return isKcKind(value) ? value : "concept";
}

function asEdgeKind(value: unknown): EdgeKind | null {
  return isEdgeKind(value) ? value : null;
}

/**
 * Parse the raw `concepts` frontmatter array into typed nodes. Defensive: the
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

/**
 * Per-KC-kind styling: a class suffix for the node tint and legend dot
 * (`bbx-cm-kind-<suffix>` in concept-map.css).
 */
export const KIND_META: Record<KcKind, { label: string; className: string }> = {
  principle: { label: "principle", className: "bbx-cm-kind-principle" },
  concept: { label: "concept", className: "bbx-cm-kind-concept" },
  procedure: { label: "procedure", className: "bbx-cm-kind-procedure" },
  fact: { label: "fact", className: "bbx-cm-kind-fact" },
};

/** Display order for the legend. */
export const KIND_ORDER: readonly KcKind[] = ["principle", "concept", "procedure", "fact"];

/**
 * Per-edge-kind styling. The class sets `color` on the edge group and the path
 * strokes `currentColor`. `complements` and `commonly-confused-with` are
 * dashed; `complements` is the symmetric spiral.
 */
export const EDGE_META: Record<EdgeKind, { label: string; className: string; dashed: boolean }> = {
  prerequisite: { label: "prerequisite", className: "bbx-cm-edge-prerequisite", dashed: false },
  complements: { label: "complements", className: "bbx-cm-edge-complements", dashed: true },
  "contrasts-with": { label: "contrasts with", className: "bbx-cm-edge-contrasts-with", dashed: false },
  "applied-in": { label: "applied in", className: "bbx-cm-edge-applied-in", dashed: false },
  "commonly-confused-with": {
    label: "commonly confused with",
    className: "bbx-cm-edge-commonly-confused-with",
    dashed: true,
  },
};

export const EDGE_ORDER: readonly EdgeKind[] = [
  "prerequisite",
  "complements",
  "contrasts-with",
  "applied-in",
  "commonly-confused-with",
];

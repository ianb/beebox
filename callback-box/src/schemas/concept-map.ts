/**
 * Concept-map card schema — a module-scale knowledge graph.
 *
 * One card holds the whole graph for one bounded topic: concepts are in-card
 * NODES (not separate cards), and edges reference other nodes by their `id`
 * WITHIN this same card (not file refs), so the graph is self-contained —
 * moving or renaming the card never breaks an edge.
 *
 * The graph is loose and deliberately allows cycles: two concepts that must be
 * learned together (a spiral) are an honest `complements` cycle, not an error.
 *
 * See docs/plans/courseware-phase1.md.
 */

import { body, cardSchema, type CardSchema, type LintIssue } from "../cards/index.js";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

/** Knowledge-component type — a strong hint to *how* a node is taught. */
const ConceptKind = z.enum(["fact", "concept", "procedure", "principle"]);

/** Optional target Bloom level for a node. */
const ConceptDepth = z.enum(["remember", "understand", "apply", "analyze", "evaluate", "create"]);

/**
 * Edge type — a CLOSED set, required on every edge. There is deliberately no
 * catch-all "other": an edge must commit to one teaching-meaningful relation.
 * The choosing rubric lives in the card instructions below.
 */
const RelationKind = z.enum([
  "prerequisite",
  "complements",
  "contrasts-with",
  "applied-in",
  "commonly-confused-with",
]);

/** An edge to another node IN THIS card, named by its `id`. */
const ConceptRelation = z.object({
  to: z.string(),
  kind: RelationKind,
});

/** One node in the graph. */
const ConceptNode = z.object({
  id: z.string(),
  name: z.string(),
  kind: ConceptKind,
  gloss: z.string().optional(),
  depth: ConceptDepth.optional(),
  misconceptions: z.array(z.string()).optional(),
  related: z.array(ConceptRelation).optional(),
});

/**
 * Intra-card graph integrity (self-contained — sees only this card's fields):
 *   - every concept `id` is unique
 *   - every edge `to` resolves to a node `id` in this card
 * Cycles are NOT errors — they are valid (spirals). An empty `concepts: []`
 * is allowed (a map being built up). Re-parsing `concepts` with the node schema
 * yields typed data without `as` casts; a shape failure here is already reported
 * by the main frontmatter parse, so we just skip. Issues returned by a `validate`
 * hook are treated as errors by the lint dispatch (card-lint.ts), so this only
 * reports genuine corruption, never advisory notes.
 */
function conceptMapErrors(fields: Record<string, unknown>): LintIssue[] {
  const parsed = z.array(ConceptNode).safeParse(fields["concepts"]);
  if (!parsed.success) return [];
  const nodes = parsed.data;
  const errors: LintIssue[] = [];

  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) {
      errors.push({ type: "id", severity: "error", message: `duplicate concept id "${node.id}"` });
    }
    ids.add(node.id);
  }
  for (const node of nodes) {
    for (const edge of node.related ?? []) {
      if (!ids.has(edge.to)) {
        errors.push({
          type: "id",
          severity: "error",
          message: `concept "${node.id}" has an edge to unknown node id "${edge.to}"`,
        });
      }
    }
  }
  return errors;
}

export const ConceptMapSchema: CardSchema = cardSchema("concept-map", {
  validate: ({ fields }) => conceptMapErrors(fields),
  fields: {
    concepts: z.array(ConceptNode),
    body: body(z.string()),
  },
  instructions: `# Concept-Map Cards

A concept-map is a **module-scale knowledge graph**: one card holds the whole graph for one bounded topic. Concepts are **nodes inside this card** (not separate cards), and edges reference other nodes **by their \`id\` within this same card** — they are *not* file refs. The graph is self-contained, so moving or renaming the card never breaks an edge.

The graph is **loose, and cycles are intended.** Two concepts that only make sense together — that a learner bootstraps at the same time — are an honest \`complements\` cycle, not an error to fix. Don't contort the graph to avoid a cycle.

## Frontmatter

\`\`\`yaml
concepts:
  - id: vectors                 # stable, unique in this card; how progress refers to this node later
    name: Vectors
    kind: concept               # fact | concept | procedure | principle  (see "kind", below)
    gloss: A quantity with magnitude and direction.   # optional one-liner
    depth: understand           # optional target Bloom level
    misconceptions:             # optional — only ones you've actually observed in a learner
      - Thinking a vector is just its length, ignoring direction
    related:                    # optional edges to other nodes IN THIS card
      - { to: matrices, kind: complements }
\`\`\`

Each concept needs an \`id\`, a \`name\`, and a \`kind\`; everything else is optional. A node \`id\` must be unique in the card, and every edge \`to\` must name a real node \`id\` — both are checked.

## \`kind\` — a strong hint to *how* to teach the node

Not the whole story, but a strong steer:

- **fact** — an arbitrary association → retrieval practice, spacing.
- **concept** — a category you recognize instances of → varied examples + non-examples.
- **procedure** — a condition→action you execute → worked examples, then faded practice.
- **principle** — a deep model that explains *why* and transfers → self-explanation, contrasting cases.

## Edges — pick one \`kind\` from the closed set (no "other")

An edge is optional, but if you draw one it **must** carry a \`kind\` from this set. There is no catch-all "related to" — an edge commits to a teaching-meaningful relation:

- **prerequisite** — B genuinely can't be grasped without A. Sequence A before B; if a learner struggles with B, revisit A.
- **complements** — A and B reinforce each other and are learned together. This is where spirals (and cycles) live.
- **contrasts-with** — A and B are clarified by comparison. Teach the distinction explicitly.
- **applied-in** — A (a principle or procedure) is put to work in B. Use it to ground the abstract and show transfer.
- **commonly-confused-with** — learners conflate A and B. Do an explicit disambiguation.

## Body

The body is the framing: what this map covers, where concepts spiral together, and the design rationale. The actual teaching material lives in a course's \`material/\`, not here.`,
});

/**
 * Starter concept-map for \`cb create\`: one example node and a framing body, so
 * a freshly created map parses and is ready to extend.
 */
export function createConceptMapTemplate(options: { title?: string | undefined }): string {
  const fields: Record<string, unknown> = {
    concepts: [
      {
        id: "first-concept",
        name: "First concept",
        kind: "concept",
        gloss: "One-line description of this concept.",
      },
    ],
  };
  if (options.title !== undefined && options.title !== "") {
    fields["title"] = options.title;
  }
  const yamlText = stringifyYaml(fields);
  const bodyText = "Describe what this map covers and how the concepts spiral together.\n";
  return `---\n${yamlText}---\n${bodyText}`;
}

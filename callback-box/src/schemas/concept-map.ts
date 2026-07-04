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
 * See docs/implemented-plans/courseware-phase1.md.
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

/**
 * Self-contained SHAPE warnings (advisory, not errors): an orphan node — one
 * with no edge in or out — is usually a modeling smell (it doesn't belong, or a
 * real relation went unstated). Returned as warnings so they surface without
 * blocking; card-lint.ts dispatches this for `concept-map` cards. A map of 0–1
 * nodes can't have edges, so it's never flagged. Re-parsing yields typed data;
 * a shape failure is already reported by the main frontmatter parse, so skip.
 */
export function conceptMapShapeWarnings(fields: Record<string, unknown>): LintIssue[] {
  const parsed = z.array(ConceptNode).safeParse(fields["concepts"]);
  if (!parsed.success) return [];
  const nodes = parsed.data;
  if (nodes.length <= 1) return [];

  const connected = new Set<string>();
  for (const node of nodes) {
    for (const edge of node.related ?? []) {
      connected.add(node.id); // has an outgoing edge
      connected.add(edge.to); // target has an incoming edge
    }
  }
  const warnings: LintIssue[] = [];
  for (const node of nodes) {
    if (!connected.has(node.id)) {
      warnings.push({
        type: "reference",
        severity: "warning",
        message: `concept "${node.id}" is an orphan — no edge in or out; connect it or remove it`,
      });
    }
  }
  return warnings;
}

export const ConceptMapSchema: CardSchema = cardSchema("concept-map", {
  description: "A module-scale knowledge graph for one bounded topic — concepts as in-card nodes with typed edges; a course component",
  category: "authored",
  validate: ({ fields }) => conceptMapErrors(fields),
  fields: {
    concepts: z.array(ConceptNode),
    body: body(z.string()),
  },
  instructions: `# Concept-Map Cards

A concept-map is a **module-scale knowledge graph**: one card holds the whole graph for one bounded topic. Concepts are **nodes inside this card** (not separate cards), and edges reference other nodes **by their \`id\` within this same card** — they are *not* file refs. The graph is self-contained, so moving or renaming the card never breaks an edge.

The graph is **loose, and cycles are intended.** Two concepts that only make sense together — that a learner bootstraps at the same time — are an honest \`complements\` cycle, not an error to fix. Don't contort the graph to avoid a cycle.

## Scope — fit, not completeness

A node should be something you'll actually *teach* toward the course's success-criteria, not everything that could be said about the topic. Don't node-ify background the learner already has — assume it in a sentence. **Tune how far back the map starts to what you know about the learner:** with a real read on their edge (a probe, or a specific \`audience\`), start near it; with little to go on (a generic course, no probe), starting more completely from the foundations is the right fallback. Completeness is for low information, not the default.

## Building the map — naming and shape

Scope decides *what's in*; these rules keep what's in actually teachable:

- **Name nodes as entities, not questions.** "Proton Transfer," never "What is proton transfer." Each \`name\` is a noun-phrase a learner could be heard saying, clear and specific.
- **Right granularity — one teachable unit per node.** Not a whole topic, not a trivia-sized sub-fact. If you'd teach two things in the same breath, they're one node; if a "node" needs its own little arc, split it.
- **No orphans.** Every node should connect to the rest by at least one edge. A concept floating with no edges almost always means it doesn't belong, or that a real relationship went unstated. (The lint warns on orphans.)
- **Edges are real relations, not decoration.** Draw an edge only where the relationship genuinely holds, and commit it to a \`kind\` (below). Don't wire nodes together just to look connected.
- **Avoid a degenerate straight line.** If the map is just A→B→C→D, each node depending only on the one before, you've under-modeled it — real subjects branch and reconverge. A spine is fine; a single unbranched chain usually means missing structure.
- **The most depended-on node is load-bearing.** The concept several others build on is the one to get right and introduce early — let the graph's shape show you where the weight sits.

Because a course is usually built automatically (the learner can't review the graph), **read the finished map back against these rules before building anything on it** — that self-check is the quality gate.

## Frontmatter

\`\`\`yaml
concepts:
  - id: vectors                 # stable, unique in this card; how progress refers to this node later
    name: Vectors
    kind: concept               # fact | concept | procedure | principle  (see "kind", below)
    gloss: A quantity with magnitude and direction.   # optional one-liner
    depth: understand           # optional target Bloom level
    misconceptions:             # optional — the COMMON misconceptions about this concept
      - Thinking a vector is just its length, ignoring direction
    related:                    # optional edges to other nodes IN THIS card
      - { to: matrices, kind: complements }
\`\`\`

Each concept needs an \`id\`, a \`name\`, and a \`kind\`; everything else is optional. A node \`id\` must be unique in the card, and every edge \`to\` must name a real node \`id\` — both are checked.

\`misconceptions\` are the **common, known** wrong models for this concept — what learners *typically* get wrong — so the teaching can preempt them. They describe the *subject*, not any one learner, and are reusable across courses. (Which misconceptions a **specific** learner actually holds is per-learner state — that goes in the \`progress\` card, not here.)

## \`kind\` — a strong hint to *how* to teach the node

Not the whole story, but a strong steer:

- **fact** — an arbitrary association → retrieval practice, spacing.
- **concept** — a category you recognize instances of → varied examples + non-examples.
- **procedure** — a condition→action you execute → worked examples, then faded practice.
- **principle** — a deep model that explains *why* and transfers → self-explanation, contrasting cases.

## \`depth\` — the target Bloom level (optional)

\`depth\` names *how deeply* the learner should hold a node — a target, not a test. The six Bloom levels:

- **remember** — recall the fact or term.
- **understand** — explain it in their own words; grasp the mechanism.
- **apply** — use it in a new but similar situation.
- **analyze** — break it down, compare, see how the parts relate.
- **evaluate** — judge, critique, choose between options.
- **create** — combine it into something new.

\`depth\` works *with* \`kind\` to steer teaching: a \`fact\` at **remember** wants spaced retrieval; a \`principle\` at **analyze** wants contrasting cases and self-explanation; an **understand** target is rarely served by a passive read. The exposition-plan turns the (kind, depth) pair into concrete approaches — so set \`depth\` where the intended level isn't obvious.

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

# Courseware Phase 1 — the `concept-map` card + authoring skill

This plan introduces the first slice of a "courseware" card family: a single
card type, **`concept-map`**, plus a pedagogically-grounded authoring process
(a skill) that lets a box agent build and revise one with a learner. A
`concept-map` is a self-contained, module-scale learning unit: a framed graph of
the concepts in one bounded topic — each node carrying a knowledge-component
type and known misconceptions, related to other nodes by loose edges — together
with informal goals and a living rationale.

The governing reframe: **in callback-box the agent is the tutoring engine; cards
are the durable models.** We are not porting a numeric ITS runtime (no Bayesian
Knowledge Tracing, IRT, or FSRS). We persist a small research-grounded data
model and encode the pedagogical discipline as `instructions` + an authoring
skill the agent follows.

Three deliberate stances, settled in design discussion, that this plan commits to:

- **Graph-as-a-card, not concepts-as-cards.** The whole concept graph for one
  module lives inside one card; concepts are *nodes in the card*, not separate
  files. There is no global, ever-growing concept registry. The scale is one
  module, full stop — no course-of-modules wrapper in Phase 1.
- **The graph is loose, and cycles are a feature.** No directed-acyclic-graph
  constraint. Two concepts that must be bootstrapped together (a spiral) are an
  honest mutual edge, not a modeling error. We do not enforce acyclicity or
  compute a topological order; relationships describe the subject, including its
  genuine circularities.
- **No measurable objectives in the schema.** ABCD/Mager-style objectives bake in
  a normalized, standardized learner — the opposite of a 1:1 tutor's stance.
  Mastery is handled in the *process*: self-report plus casual, in-conversation
  assessment. Nothing in the card declares a degree or threshold.

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md` → **"Read before writing. Don't guess file formats… This
  project has specific conventions that differ from defaults."** Every schema/registration
  claim below cites the file it was read from.
- `callback-box/CLAUDE.md` → **"Keep source and docs generic — never hardcode personal
  names… Refer to 'the user' or 'the boxholder' in shared text."** The `instructions` and
  the authoring skill are shared text and stay generic — "the learner", not a name.
- `callback-box/CLAUDE.md` (Cards) → **"Schemas can include `instructions` — prose embedded
  in the schema that's injected into agent context when processing cards of that type."**
  The mechanism Phase 1 leans on hardest; see `init-rules.ts`.
- `callback-box/CODE-STYLE.md` → **"No default parameters"**, **"Max 2 positional
  parameters"**, **"NEVER use `any`"**, double quotes, semicolons. Applies to the schema
  file, the template generator, the `validate` hook, and any provisioning code.
- `callback-box/CLAUDE.md` → **"don't add features beyond what the task requires."** The
  lightweight stances above are the scope guardrail: no DAG machinery, no measurable
  objectives, no per-concept cards, no multi-module hierarchy in Phase 1.
- Most recent shipped precedent for a structured, instruction-heavy card type with a
  self-contained validation hook: **`LandmarkSchema`** (`callback-box/src/schemas/landmark.ts`)
  for the `instructions` voice and `create*Template`; and the `validate` hook contract at
  `callback-box/src/cards/schema.ts:104-128` for the intra-card integrity check.

## What already exists

- **Card-type declaration primitive** — `cardSchema(type, { fields, instructions?,
  searchable?, validate? })` at `callback-box/src/cards/schema.ts:165`. Frontmatter fields
  are Zod types; at most one body field via `body()` (`schema.ts:52`), which must be named
  `body` (`schema.ts:176`). Globals `title`/`contains`/`content-type` auto-injected unless
  redeclared (`schema.ts:87`, applied at `schema.ts:196`). **Reuse as-is** — `concept-map`
  is one ordinary `cardSchema()` call.
- **Self-contained `validate` hook** — `CardSchemaConfig.validate(input: CardValidateInput)`
  returns `LintIssue[]`; `CardValidateInput` is `{ fields }` — *the card's own data and
  nothing else* (`schema.ts:104-128`). Box-aware checks (cross-card refs) are deliberately
  excluded and live in `card-lint.ts`. **Reuse — and this is the key enabler:** because the
  whole concept graph lives inside one card, graph integrity (every edge points at a real
  node id; ids are unique) *is* self-contained and validates cleanly in this hook. The
  cross-card validation problem that sank the earlier DAG design simply doesn't arise.
- **Lenient parse** — unknown frontmatter keys are stripped in memory and surfaced as a lint
  *warning*; a missing required field or wrong type fails at parse (`schema.ts:206-213`).
  **Reuse** — keep required fields minimal so a half-built map still loads.
- **Ref convention** — keys literally named `ref`/`refs` are cross-*card* edges
  (`extractRefs`, `schema.ts:240`). **Note:** Phase 1's intra-graph edges are **not** refs —
  `related.to` is a node id *within the same card*, so it never touches the file-ref system,
  never produces a broken-ref warning, and is validated by the `validate` hook instead. Refs
  remain available if a map later points at another card (e.g. shared material in Phase 2).
- **Schema registration** — `cardSchemas[]` at `callback-box/src/schemas/registry.ts:54`; a
  new type is imported and appended. **Reuse.**
- **Template registry** — `registerTemplate({ name, description, cardTypes, defaultForTypes?,
  argsSchema, generate })` (`callback-box/src/schemas/templates-builtins.ts:28`). Powers
  `cb create -t`. **Reuse**, modeled on `createLandmarkTemplate` (`landmark.ts:196`).
- **Storage dirs** — `BOX_DIRS` at `callback-box/src/cli/lib/paths.ts:24`; `cb init` creates
  them. **Reuse** — add a `courses` key (concept-maps, and later their material/progress, can
  coexist there or live in any tree the author chooses).
- **`instructions` → box rule** — `generateRules(boxRoot)` (`callback-box/src/core/init-rules.ts:65`)
  writes one `.claude/rules/card-<type>.md` per schema with `instructions`, gated by glob
  `**/*.<type>.card` (`init-rules.ts:99-114`), auto-loading when the agent reads/edits a
  matching card. **Reuse** — `concept-map` instructions ride this for free.
- **Hyphenated type names are fine** — existing types `email-thread`, `todo-list`,
  `chat-thread` (`registry.ts:34,38`) confirm `concept-map` as a type string and
  `Name.concept-map.card` filename work.
- **Instructions voice precedent** — `LandmarkSchema.instructions` (`landmark.ts:124-163`):
  what the card is → field-by-field examples → special cases → lifecycle. **Reuse the voice.**

What does **not** exist and must be built net-new:

- **A box skills-provisioning mechanism.** Boxes get `.claude/rules/` and
  `.claude/settings.json` (confirmed: `~/src/boxes/test1/.claude/` holds `rules/` +
  `settings.json`, no `skills/`). `generateRules` provisions rules; nothing provisions
  skills. The authoring flow we're shipping as a *skill* has no install path yet — Track A.
- **`LintIssue` construction in a `validate` hook.** No existing schema ships a `validate`
  hook to copy verbatim; its exact shape must be read from `src/cards/lint-format.ts` at
  implementation time (noted in Implementation order).

## Prior art (external)

The pedagogy/ITS research backing the model was gathered in a prior research pass; citations
carried here so the design stands alone. What survived the design discussion is a *subset* —
the parts compatible with a loose, learner-centric, lightweight model:

- **Knowledge Components & the KLI framework** (Koedinger, Corbett & Perfetti 2012) — a KC is
  a unit finer than a topic; KCs come in *types* that are learned by different processes and
  so want different instruction. https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1551-6709.2012.01245.x .
  **Kept:** the node `kind` enum (`fact | concept | procedure | principle`) is the KC type —
  it tells the agent *how* to teach that node (facts → retrieval/spacing; concepts → examples
  + non-examples; procedures → worked examples then practice; principles → self-explanation).
- **Bloom's revised taxonomy** (Anderson & Krathwohl 2001) — six cognitive levels.
  https://www.niu.edu/citl/resources/guides/instructional-guide/writing-goals-and-objectives.shtml .
  **Kept (lightly):** an optional per-node `depth` enum captures the target level. Paired with
  `kind` it gives the agent "how to teach" + "to what depth." Optional, not enforced.
- **Spiral curriculum** (Bruner) — revisit concepts at increasing depth; some are bootstrapped
  together. https://helpfulprofessor.com/spiral-curriculum/ . **Kept:** the loose graph with
  `complements` edges and permitted cycles is exactly the spiral structure; this is *why* we
  rejected the DAG.
- **Contingent (Piagetian) clinical interviewing** — probe contingent on the last answer;
  chase the reasoning behind wrong answers. **Kept:** the authoring skill's "probe, don't
  quiz with a form" step, married to self-report and casual assessment.
- **Living learning contract / andragogy** (Knowles) — goals/strategies renegotiable at any
  time. https://infed.org/dir/welcome/malcolm-knowles-informal-adult-education-self-direction-and-andragogy/ .
  **Kept:** the `concept-map` body holds a living, revisable rationale; the skill has a revise
  path.
- **Backward design / UbD** (Wiggins & McTighe) — desired results before activities.
  https://en.wikipedia.org/wiki/Understanding_by_Design . **Kept (softened):** the skill
  elicits goals before building the graph, but as informal `goals` prose, not formal
  outcome/evidence objects.

**Rejected from the research, on purpose** (recorded so a reader doesn't "helpfully" re-add
them): ABCD/Mager measurable objectives (normalize a standardized learner — wrong stance for
1:1); strict prerequisite **DAG** / outer-fringe / topological sequencing (falsifies subjects
with genuine circular dependencies); numeric learner modeling (BKT/IRT/FSRS — the agent
reasons qualitatively); a global concept graph spanning modules (we stay module-scale).

**Library-limitation search:** the only third-party surfaces are Zod (already the schema
substrate everywhere) and Claude Code's `.claude/` conventions. No external library is asked
to do anything non-obvious, so no library-bug search applies — flagged rather than omitted.
The one genuine external unknown is **how Claude Code discovers box-level skills** (does
`.claude/skills/<name>/SKILL.md` under the box working directory get picked up the way
`.claude/rules/` does?) — verified in Track A, not assumed.

## Tracks / scope

Ordered by implementation dependency, then surface size.

### Track A — Authoring-skill home (decide + provision)

**What.** Decide where the `build-concept-map` authoring flow lives and how it reaches a box,
then provision it. The card-`instructions` half is free (Track B rides `init-rules.ts`); the
*skill* half has no install path today.

**Why this needs to change.** A path-conditional rule (`**/*.concept-map.card`) only loads
once a card already exists and is being read/edited (`init-rules.ts:102`). The authoring flow
must be reachable *before any card exists* ("teach me linear algebra" with an empty box).

**Direction.** Two viable shapes; pick in Open Questions before this track closes:

- **A1 (lean, recommended): a box skill via a new `generateSkills(boxRoot)`** mirroring
  `generateRules` (`init-rules.ts:65`) — copy a `build-concept-map` SKILL.md from a dev-repo
  asset into the box's `.claude/skills/`, with the same clean-and-rewrite idempotency
  (`init-rules.ts:69-85`). Realizes the user's "skill" choice with ~one function. Conditional
  on box skills being auto-discovered.
- **A2 (fallback): an always-on `.claude/rules/` file** (no `paths:` filter → globally in
  context) plus a one-line CLAUDE.md pointer. No new mechanism; weaker (always in context vs.
  invoked).

**First implementation chunk.** Verify box-skill discovery (write a throwaway
`~/src/boxes/test1/.claude/skills/probe/SKILL.md`, start a box agent, confirm it lists). The
chunk's deliverable *is* the A1-vs-A2 decision with evidence; no schema work depends on the
wrong answer.

### Track B — `concept-map` card type

**What.** The graph-as-a-card. One card = one module's concept graph + informal goals + a
living framing body.

**Why this needs to change.** Nothing models a bounded topic as an internal graph of
KC-typed concepts with loose, possibly-circular relationships. This is the whole Phase 1
content artifact.

**Direction.** Concrete Zod (illustrative; follows CODE-STYLE — double quotes, explicit
shapes, named objects):

```typescript
// src/schemas/concept-map.ts
const ConceptKind = z.enum(["fact", "concept", "procedure", "principle"]);   // KC type
const BloomDepth = z.enum(["remember", "understand", "apply", "analyze", "evaluate", "create"]);
const RelationKind = z.enum(["leads-to", "complements", "relates-to"]);      // loose, cycles OK

const ConceptRelation = z.object({
  to: z.string(),                       // a node `id` within THIS card (not a file ref)
  kind: RelationKind.optional(),
});

const ConceptNode = z.object({
  id: z.string(),                       // stable handle, unique in-card; how progress addresses it later
  name: z.string(),
  kind: ConceptKind,                    // how to teach this node
  gloss: z.string().optional(),         // one-line description
  depth: BloomDepth.optional(),         // optional target Bloom level
  misconceptions: z.array(z.string()).optional(),
  related: z.array(ConceptRelation).optional(),
});

const conceptMapFields = {
  goals: z.array(z.string()).optional(),  // informal — what this module is for
  concepts: z.array(ConceptNode),         // the graph nodes (defining content)
  body: body(z.string()),                 // framing narrative: goal/motivation/gap, spirals, rationale — living
};

export const ConceptMapSchema: CardSchema = cardSchema("concept-map", {
  fields: conceptMapFields,
  instructions: `# Concept-Map Cards …`,
  validate: ({ fields }) => {
    // intra-card graph integrity (self-contained, no cross-card access):
    //   - every concepts[].id is unique
    //   - every related[].to matches some concepts[].id
    // returns LintIssue[] (warnings); cycles are NOT an error.
  },
});
```

Deliberately **absent**: per-concept cards, prerequisite *refs*, DAG/acyclicity, measurable
objectives, numeric mastery, a multi-module wrapper.

**Vocabulary lock-ins** (ship into every box's `card-concept-map.md` rule and the skill):
node fields `id` / `name` / `kind` (the four KC types) / `gloss` / `depth` (six Bloom levels)
/ `misconceptions` / `related`; edge fields `to` / `kind` (`leads-to` | `complements` |
`relates-to`); card fields `goals` / `concepts` / `body`.

**First implementation chunk.** Write `src/schemas/concept-map.ts` (schema + `validate` +
`instructions` + `createConceptMapTemplate`); register in `registry.ts:54` array + re-export;
add the template in `templates-builtins.ts`; add `courses: "store/courses"` to `BOX_DIRS`
(`paths.ts:24`); add a parse + validate doctest. No open questions inside this chunk (Bloom
`depth` and relation-kind vocabulary are settled above).

### Track C — `build-concept-map` authoring flow (the pedagogy)

**What.** The process the agent follows to build or revise a `concept-map` with a learner.
Authored once in the home Track A decides; pointed to from the card's `instructions`.

**Why this needs to change.** The boxholder's core ask is that the cards "guide the agent
through a thorough and pedagogically grounded process." The schema is intentionally thin
*because* the rigor lives here.

**Direction.** A five-step flow, each step naming its grounding:

1. **Elicit the goal — informally.** Why now, what for, what does success feel like, what
   constraints. Conversation, not a form. (Living learning contract — Knowles; backward design
   — name the destination first.) Captured as `goals` + body narrative.
2. **Probe existing knowledge — casually and contingently.** Short, branch-on-the-answer
   probing mixed with self-report ("how comfortable are you with X?") and light checks — never
   a pretest. Hunt for **misconceptions**, not just gaps (a confidently-held wrong model
   matters more than an absence). (Piagetian clinical interview.) Stop when the picture is good
   enough.
3. **Build the concept graph.** Identify the nodes for this module, assign each a KC `kind`
   (and optional Bloom `depth`), write a `gloss` and any `misconceptions` you actually
   observed, and draw `related` edges. **Spirals are expected** — when two concepts only make
   sense together, say so with mutual `complements` edges; don't contort the graph to avoid a
   cycle. (KLI for KC types; Bruner for spirals.)
4. **Frame the module.** Write the body: the learner's goal/motivation/gap (informal,
   self-reported), how the module is meant to be taught, where things spiral together, and the
   design rationale. State that the map is living.
5. **Confirm & revise.** Show the learner the shape, get buy-in. The revise path re-runs steps
   2–4 against the existing card — amend/append nodes, re-gloss, add edges, log what changed in
   the body — rather than starting empty.

**First implementation chunk.** Draft the flow text in the Track-A home; wire a one-line
pointer into the schema's `instructions` ("To build or revise a concept-map, follow the
courseware authoring process"). Depends on Track A's decision and Track B's vocabulary.

## Subplans

None. **Candidate:** if Track A lands on A1 and box-skills provisioning proves more than a thin
`generateSkills` mirror of `generateRules` (its own asset bundling, multi-skill registry,
reinit cleanup), promote it to `courseware-skill-provisioning.subplan.md` — it's reusable
infrastructure other future box skills would share. Held inline because the expected shape is
one function mirroring an existing one.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `related[].to` points at a node id that isn't in `concepts` (typo, or deleted node) | Will add (validate doctest) | **Yes — net-new `validate` hook** flags it (`schema.ts:104` gives it the whole card) | Clear (lint warning naming the edge) |
| Duplicate `concepts[].id` | Will add | **Yes — `validate` hook** | Clear (warning) |
| Invalid `kind` / `depth` / relation `kind` value (hand-edit) | Will add (parse doctest) | Yes — Zod enum rejects at parse | Clear (parse error) |
| A `complements` cycle A↔B (or longer) | n/a — **not a failure** | Intentionally none | n/a (cycles are valid by design) |
| Card loads with `concepts: []` or no goals (half-built) | Will add | Yes — `goals` optional; `concepts` may be empty; lenient parse (`schema.ts:206`) | Clear (loads; `validate` may note an empty map) |
| Hand-edited stray/misspelled key (`relates:` vs `related:`) | Covered by lenient-parse behavior | Yes — unknown key stripped + lint warning (`schema.ts:206-213`) | Clear (warning); the edge is silently absent until noticed |
| Agent fabricates concepts/misconceptions the learner never showed | No (not mechanically detectable) | Partial — skill step 2/3 say "misconceptions you *observed*", model reality | Silent (honesty risk; mitigated by process) |
| Box skill not discovered (Track A1 assumption wrong) | Track A's first chunk *is* this test | Yes — A2 fallback | Clear (caught before ship) |

> **Critical gaps:** none. The one that worried the earlier design — cross-card prerequisite
> cycle detection — is gone twice over: cycles are now *allowed*, and graph integrity is
> *intra-card*, so the `validate` hook catches the only real corruption (dangling/duplicate
> node ids) synchronously. The remaining silent risk (fabricated content) is inherent to a
> prose-first model and accepted, not a gap a schema can close.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — agent writes a relation as a bare string instead of `{ to }`,
  or puts a misconception under `related`. **ADDRESSED** — Zod shape mismatch fails at parse
  for the structural cases; `instructions` field-by-field examples (per `landmark.ts:124-163`)
  cover the rest.
- **Stale ref** — largely **N/A** in Phase 1: intra-graph edges are node ids, not file refs,
  so moving/renaming the card never breaks them (they travel inside it). If a map later refs
  another card (Phase 2), the existing `resolveRefExists` warning path (`ref-exists.ts:68`)
  applies.
- **Two agents touching the same map** — concurrent edits to `concepts`. **DEFERRED** — same
  parse-mutate-reserialize last-write behavior as every card type; no new surface. Cited in
  NOT-in-scope.
- **Hand-edit drift** — boxholder edits `concepts:` YAML with a wrong sub-key. **ADDRESSED** —
  lenient parse strips it + lint warns; the `validate` hook additionally catches a dangling
  edge id introduced by a hand edit.
- **Fabricated free-form value** — agent invents a misconception/concept. **GAP (by design)** —
  not mechanically detectable; skill steps 2–3 make honesty the low-friction path. Accepted as
  the limit of a lightweight, prose-first model.
- **Validation error UX** — `validate` returns `LintIssue[]`; the message should name the
  offending node/edge id so it reads clearly in agent context. **ADDRESSED** (implementation
  note: phrase the issue with the id).
- **Partial migration / transition state** — none; net-new card type, no existing data.
  **ADDRESSED** (nothing to do).

## NOT in scope

- **Material / activity content (Phase 2).** A Phase-1 `concept-map` describes *what* to learn
  and *how to teach each node*, not the presentational material or chat-guiding activities —
  including the "hidden, verified answer key the model retrieves but never emits" discipline,
  which belongs to activities. Rationale: the graph is usable and testable alone; material
  attaches to its nodes later.
- **Multi-module / course-of-modules wrapper.** No card that orders several `concept-map`s.
  Rationale: the boxholder explicitly wants to stay at module scale for now; cross-card refs
  exist when stringing modules together becomes a real need.
- **Progress / mastery tracking (Phase 3).** No per-learner state; the learner's goals/gap
  live in the map body, informally. Rationale: separable, and depends on having maps to track
  against. (Node `id`s are seeded now so later progress can address nodes.)
- **Assessment items / spaced review (Phase 4).** No probe cards, no scheduling. Phase 1's
  "assessment" is the skill's casual, in-conversation probing, not a data structure.
- **Numeric learner modeling (BKT / IRT / FSRS)** — rejected for the whole direction.
- **A custom frontend renderer.** Phase 1 uses the default frontmatter-card view; a bespoke
  graph view earns its own design once the shape has settled in use.
- **Concurrency reconciliation for co-edited maps** — same as all cards; out of scope.

## Open design questions

- **Authoring-skill home (Track A): A1 (box skill via new `generateSkills`) vs A2 (always-on
  rule + CLAUDE.md pointer).** *Lean:* A1 if box-level `.claude/skills/` are auto-discovered —
  it's the user's stated choice and a clean mirror of `generateRules`. Verify first; fall back
  to A2.
- **Is an empty `concepts: []` a parse error, a `validate` warning, or fine?** *Lean:* allow it
  to parse (half-built maps load) and have `validate` emit a gentle "this map has no concepts
  yet" warning. Revisit if it's noisy during authoring.
- **Do node `id`s need a uniqueness/format convention now (e.g. kebab-case) for Phase-3
  progress addressing?** *Lean:* require unique (enforced by `validate`) but not a format;
  document a kebab-case suggestion in `instructions`. Promoting to a hard rule is a later,
  forward-only tightening.
- **Should `related.kind` be required rather than optional?** *Lean:* optional — an unlabeled
  edge ("these are related") is honest and common; forcing a label invites fake precision,
  which cuts against the loose-graph stance.

## Knowledge audits

New agent-facing concepts that should land with at least one `knows_directly` audit in
`callback-box/src/dev/knowledge-audits.yaml`:

- **`concept-map` card shape** — can the agent, from the box rules alone, state that one card
  holds the whole module graph, concepts are in-card nodes (not separate cards), and edges are
  node ids, not file refs?
- **KC `kind` drives teaching** — can it recall the four kinds and that `kind` selects the
  instructional approach (fact→retrieval, procedure→worked-examples, etc.)?
- **Cycles are allowed / spirals are intended** — can it recall that the graph is loose and a
  mutual `complements` edge is valid, not an error to fix?
- **Authoring flow exists and its entry point** — building a map means following the courseware
  authoring process (elicit → probe → build graph → frame → revise), not writing a card cold.

Audits land **run**, not just written: `pnpm knowledge-audit run --box <abs-path-to-test-box>
--filter courseware` before the plan completes (note: `--box` must be an absolute path or
omitted — a bare name resolves to a dir inside the monorepo). Skip-with-rationale: none.

## Implementation order

1. **Track A chunk** — verify box-skill discovery; decide A1/A2. (Unblocks C's home; does not
   block B.)
2. **Track B** — read `src/cards/lint-format.ts` for the `LintIssue` shape, then write the
   `concept-map` schema + `validate` + template + registration + `BOX_DIRS` + parse/validate
   doctest. (Locks the node/edge vocabulary that C references.)
3. **Track C** — author the `build-concept-map` flow in the Track-A home; wire the pointer into
   the schema's `instructions`. (Depends on A and B.)
4. **Knowledge audits** — write the four entries; run against the test box; record the status
   comment. (Depends on B/C being in the box via `cb init`.)

Each item is one or a few commits on the worktree branch. The plan completes when all four
land; it ships (merges to main) only on the boxholder's explicit signal.

## Rollout shape

- **Test posture** (per `docs/testing.md` — tests first as a design tool, on substantial
  codepaths, not for coverage):
  - `concept-map` parse doctest — a valid card round-trips; `kind`/`depth`/relation-`kind`
    enums reject bad values; all-optional fields let a half-built map load.
  - `validate`-hook doctest — a dangling `related.to` and a duplicate `id` each produce a
    `LintIssue`; a `complements` cycle produces **none** (cycles are valid); a clean map is
    silent.
  - No test for the authoring *prose* (it's instructions, not code) — the knowledge audits are
    its verification.
- **Knowledge-audit entries** — the four above land with the plan (run + recorded).
- **Migration** — none. Net-new card type, net-new `BOX_DIRS` key, net-new skill/rule asset.
  `cb init` regenerates rules (and skills, if A1) idempotently (`init-rules.ts:69-85`), so
  `card-concept-map.md` appears on the next `cb init` with no manual step; `courses/` is
  created like every other `BOX_DIR`.

## Named future phases (room left, not designed here)

- **Phase 2 — Material & activities.** Presentational material and chat-guiding activities that
  attach to a `concept-map`'s nodes (addressed by node `id`), carrying the hidden/verified
  answer key, hints, and typed tutor moves. Mostly other (more presentational) card types the
  activity layer sequences.
- **Phase 3 — Progress.** A separable, loosely-structured progress record referencing node
  `id`s within a map — qualitative, self-report-informed mastery beliefs + evidence + last-seen
  — able to live in its own tree apart from the content.
- **Phase 4 — Casual assessment & review.** Lightweight, conversation-native checks tied to
  nodes, and gentle spaced review — no numeric engine, consistent with the Phase-1 stance.
- **Later, if ever — multi-module courses.** A wrapper that orders several `concept-map`s, only
  if module-scale proves too small in practice.

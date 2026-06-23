# Courseware Phase 1 — the learning unit: cards, rules, and the authoring skill

This plan introduces a "courseware" card family centered on one container — a
**learning unit** — that an agent builds *with* a learner through a
pedagogically-grounded process. A unit binds a few components: a **concept-map**
(the knowledge graph), an **approach** (the teaching plan, with its reasoning
kept in), **material** (presentational content, in a subdirectory), and —
tracked separately per learner — **progress** (a qualitative snapshot of what
the learner understands, with a session log). The agent-facing process that
builds and adapts all of this lives in a **skill**.

The governing reframe holds throughout: **in callback-box the agent is the
tutoring engine; cards are the durable models.** No numeric ITS runtime (no BKT,
IRT, or FSRS). We persist a small, qualitative, research-grounded data model and
put the pedagogical discipline where it belongs — see *Division of labor* below.

## Division of labor: cards vs card-rules vs skills

The whole design is organized across the three surfaces the work lives on. Being
explicit about which knowledge goes where is the spine of this plan:

- **Cards** hold *structure and state* — the graph, the approach-with-rationale,
  the progress snapshot, the unit manifest. Durable data, schema-validated.
- **Card rules/docs** — each schema's `instructions`, auto-published by
  `generateRules` to `.claude/rules/card-<type>.md` (`init-rules.ts:99-114`),
  loaded *automatically* when the agent reads or edits a card of that type. These
  hold *per-type handling*: field semantics, invariants ("cycles are fine," "keep
  the reasoning in," "status is qualitative and judged against the learner's
  goal"), and lifecycle. Not process — handling.
- **Skills** hold the *cross-card process* — the multi-step authoring/teaching
  flow, the probing technique, the two authoring modes. Invoked (not
  path-triggered), they orchestrate work *across* the cards. This is where the
  "guide the agent through a thorough, pedagogically grounded process" requirement
  is satisfied.

Rule of thumb: if guidance is about *one card type in isolation*, it's a
card-rule; if it spans cards or is a sequenced procedure, it's the skill; if
it's data, it's a field.

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md` → **"Read before writing. Don't guess file formats…"** —
  every schema/registration/attach claim below cites the file it was read from.
- `callback-box/CLAUDE.md` → **"Keep source and docs generic — never hardcode personal
  names… Refer to 'the user' or 'the boxholder' in shared text."** — instructions and
  the skill stay generic ("the learner").
- `callback-box/CLAUDE.md` (Cards) → **"Schemas can include `instructions`… injected into
  agent context when processing cards of that type."** — the card-rules surface.
- `callback-box/CODE-STYLE.md` → **"No default parameters"**, **"Max 2 positional
  parameters"**, **"NEVER use `any`"**, double quotes, semicolons — applies to every
  schema, template, and `validate` hook.
- `callback-box/CLAUDE.md` → **"don't add features beyond what the task requires."** — the
  qualitative, prose-first stances (no numeric mastery, no DAG enforcement, no measurable
  objectives, no forgetting model) are the scope guardrail.
- Precedents: **`LandmarkSchema`** (`landmark.ts`) for instruction voice, a manifest-for-a-
  directory shape, and `create*Template`; the **`validate` hook contract** (`schema.ts:104-128`)
  for intra-card integrity; the **`.attach/` convention** (`attach-path.ts`) for embedded
  components.

## What already exists

- **Card-type primitive** — `cardSchema(type, { fields, instructions?, searchable?, validate? })`
  (`schema.ts:165`); one body field via `body()` (`schema.ts:52`, must be named `body`,
  `schema.ts:176`); globals `title`/`contains`/`content-type` auto-injected (`schema.ts:87`).
  **Reuse** for all four new types.
- **Self-contained `validate` hook** — `validate(input: CardValidateInput)` → `LintIssue[]`,
  sees only the card's own data (`schema.ts:104-128`). **Reuse** — the concept-map's intra-card
  graph integrity (unique ids, edges resolve) validates cleanly here; cross-card refs stay in
  `card-lint.ts`.
- **Lenient parse** — unknown keys stripped + warned; missing-required/wrong-type fails
  (`schema.ts:206-213`). **Reuse** — keep required fields minimal so half-built units load.
- **Ref convention** — keys named `ref`/`refs` are cross-card edges (`extractRefs`,
  `schema.ts:240`); resolution is relative, box-root-absolute (`/…`), or attach-scope
  (`attach/…`) (`ref-exists.ts:52-61`); broken refs are lint **warnings** (`ref-exists.ts:68`).
  **Reuse** — unit→component, progress→unit, material→node bindings are refs.
- **`.attach/` convention** — every card may own a sibling `<basename>.attach/`; refs into it
  use `attach/…` (`attach-path.ts`). The example path `sub/scan.image.card` (`attach-path.ts`
  `attachmentPath` doc) shows **cards inside an attach scope are contemplated**. **Reuse** — the
  concept-map and approach embed here; material is a subdirectory here; the progress card's
  session log is a plain attached file.
- **`instructions` → box rule** — `generateRules(boxRoot)` writes path-globbed
  `.claude/rules/card-<type>.md`, cleaned-and-rewritten idempotently (`init-rules.ts:65-114`).
  **Reuse** — the card-rules surface for all four types, for free.
- **Schema registration** — `cardSchemas[]` (`registry.ts:54`); template registry
  (`templates-builtins.ts:28`); `BOX_DIRS` (`paths.ts:24`). Hyphenated type names work
  (`email-thread`, `todo-list`). **Reuse.**

Net-new / must-ensure:

- **Box skills-provisioning** — boxes get `.claude/rules/` + `.claude/settings.json`, **no
  `.claude/skills/`** (confirmed in `~/src/boxes/test1/.claude/`). The authoring skill has no
  install path yet.
- **First-class treatment of embedded cards.** `cb validate`'s bulk pass and the attach
  machinery treat `.attach/` contents as *asset* space — a separate `lintAttachLayout`
  (`validate.ts:251`) + per-dir manifests (`asset-manifest-scan.ts`). The PostToolUse edit hook
  validates *any* edited path, so an embedded concept-map is schema-checked when touched — but
  "attached cards are just cards" (bulk-validated, indexed, rendered like top-level cards) is a
  **requirement to verify and, if needed, implement**, not a given.
- **A `validate` hook in practice** — no existing schema ships one; read `src/cards/lint-format.ts`
  for `LintIssue` shape at implementation time.

## Prior art (external)

The pedagogy backing the surviving model (full pass done earlier; what's kept is the subset
compatible with a qualitative, learner-centric design):

- **Knowledge Components & KLI** (Koedinger et al. 2012) — KC *types* are learned by different
  processes → the concept-map node `kind` (`fact|concept|procedure|principle`) tells the agent
  *how* to teach a node. https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1551-6709.2012.01245.x
- **Bloom's revised taxonomy** — optional per-node `depth`. Used as guidance, not enforced.
- **Spiral curriculum** (Bruner) — concepts bootstrapped together → loose graph with permitted
  cycles; *why we rejected the DAG*. https://helpfulprofessor.com/spiral-curriculum/
- **Clinical interview / conceptual-change probing** (Piaget; predict-then-explain;
  anchoring-phenomenon diagnostics) — the *probe technique*: open-ended, anchored in a concrete
  familiar phenomenon, aimed at the mental model (the boxholder's "what's actually happening when
  you mix baking soda and vinegar?"). Surfaces misconceptions, which is where the action is.
- **Living learning contract / andragogy** (Knowles) — goals emerge through dialogue and stay
  renegotiable → the approach + unit body carry living rationale.
  https://infed.org/dir/welcome/malcolm-knowles-informal-adult-education-self-direction-and-andragogy/
- **Backward design / UbD** — name the destination first → goals/outcomes precede material, but
  as informal prose, not measurable objectives.
- **Khanmigo's hard-won lessons** — retrieve-don't-invent answer keys; privately enumerate the
  learner's likely solution paths; stay Socratic. https://blog.khanacademy.org/khanmigo-math-computation-and-tutoring-updates/
  → answer keys live *with material*, retrieved when teaching (matters most in the Phase-2
  tutoring runner).

**Rejected on purpose** (so a reader doesn't re-add them): ABCD/Mager measurable objectives
(normalize a standardized learner — wrong for 1:1); a strict prerequisite **DAG** (falsifies real
circular dependencies); numeric learner modeling **and any forgetting/decay model** (the
boxholder's rustiness is a 30-year starting condition, not an on-timescale process — the probe
reads present state, full stop); a global cross-unit concept graph.

**Library search:** only Zod and Claude Code's `.claude/` conventions are in play; no third-party
tool is asked to do anything non-obvious — flagged, not omitted. The one external unknown is
box-level skill discovery (Track A).

## Tracks / scope

Organized by the three surfaces. Ordered by implementation dependency.

### The cards

Four new card types. All deliberately lightweight — prose-first, minimal required fields, so a
half-built unit loads (`schema.ts:206`).

**1. `unit`** — the manifest/container. (Provisional name — see Open Questions.)

```typescript
const ComponentRef = z.object({ ref: z.string() });   // → an embedded attached card
const unitFields = {
  goals: z.array(z.string()).optional(),     // the learner's deeper "why" for this unit; refined through probing
  "concept-map": ComponentRef.optional(),    // → attach/<…>.concept-map.card
  approach: ComponentRef.optional(),         // → attach/<…>.approach.card
  material: z.string().optional(),           // subdirectory under the unit's attach scope (content + answer keys)
  progress: ComponentRef.optional(),         // optional — progress may live here OR in a separate tree
  body: body(z.string()),                    // framing narrative + rationale; living
};
```

**2. `concept-map`** — the knowledge graph (designed earlier; unchanged), embedded under the unit.

```typescript
const ConceptKind = z.enum(["fact", "concept", "procedure", "principle"]);              // KC type → how to teach
const BloomDepth = z.enum(["remember","understand","apply","analyze","evaluate","create"]); // optional target depth
const RelationKind = z.enum(["leads-to", "complements", "relates-to"]);                 // loose; cycles allowed
const ConceptRelation = z.object({ to: z.string(), kind: RelationKind.optional() });    // `to` = a node id IN THIS card
const ConceptNode = z.object({
  id: z.string(), name: z.string(), kind: ConceptKind,
  gloss: z.string().optional(), depth: BloomDepth.optional(),
  misconceptions: z.array(z.string()).optional(),
  related: z.array(ConceptRelation).optional(),
});
const conceptMapFields = { concepts: z.array(ConceptNode), body: body(z.string()) };
// validate(): unique ids; every related.to resolves to a node id. Cycles are NOT errors.
```

**3. `approach`** — the pedagogical plan, with the *reasoning kept in* (the boxholder's step 6),
embedded under the unit. This is the teaching/activity layer.

```typescript
const Modality = z.object({ name: z.string(), why: z.string().optional() });   // manipulatives, dialogs, conversations…
const Decision = z.object({ decision: z.string(), rationale: z.string() });     // so adaptation respects WHY
const approachFields = {
  emphasis: z.array(z.string()).optional(),   // weighting from the learner's goal, e.g. "principles over terminology"
  modalities: z.array(Modality).optional(),   // chosen formats + why (step 5)
  decisions: z.array(Decision).optional(),    // pedagogical decisions + rationale (step 6 — load-bearing)
  body: body(z.string()),                     // the plan narrative + reasoning; living, adapted in place (step 7)
};
```

**4. `progress`** — a per-learner qualitative snapshot, tracked over time, kept *separate* (its own
card; may live in another tree). Its **session log is a plain attached file**, not a structured card.

```typescript
const NodeStatus = z.enum(["unfamiliar", "partial", "working", "solid"]);   // qualitative; judged vs the learner's goal
const ProgressEntry = z.object({
  node: z.string(),                       // concept-map node id
  status: NodeStatus,
  notes: z.string().optional(),           // evidence / what they said / where they're shaky (incl. weak terminology that's OK)
  misconception: z.string().optional(),   // an active misconception to address, if any
});
const progressFields = {
  unit: ComponentRef.optional(),          // the unit this tracks (often a cross-tree ref)
  learner: z.string().optional(),         // who (optional; many boxes have a single learner)
  entries: z.array(ProgressEntry).optional(),  // seeded by the probe; evolving
  body: body(z.string()),                 // running summary; the session log lives in <basename>.attach/
};
```

**Material is not a new card type** — it's existing presentational cards (`doc`, `webpage`,
`image`, …) in the unit's `attach/material/` subdirectory, with answer keys alongside. The
*production* of good material (which modality, why) is the approach's + skill's job, not a schema.

**Vocabulary lock-ins:** the four type names; node `id`/`kind`/`depth`/`related`/`misconceptions`;
relation `to`/`kind` (`leads-to`|`complements`|`relates-to`); progress `status`
(`unfamiliar`|`partial`|`working`|`solid`); `approach.decisions[].rationale` as the
keep-the-reasoning-in field.

### The card rules/docs (each schema's `instructions`)

What each type's auto-published rule must convey (this is content, written in the `landmark.ts:124-163`
voice):

- **`unit`** — it's a container; its components are embedded attached cards (concept-map, approach)
  plus a `material/` subdir; progress may live here or separately; the body carries living framing;
  reuse an existing concept-map/approach by ref rather than duplicating.
- **`concept-map`** — nodes are in-card (not separate cards); edges are node ids, not file refs;
  `kind` selects the teaching approach (fact→retrieval, procedure→worked-examples, principle→
  sense-making); **cycles are valid and intended** (spirals), not errors; surface only
  misconceptions actually observed.
- **`approach`** — **keep the reasoning in**: every decision carries its rationale so later
  adaptation stays coherent (step 7); `emphasis` records the learner's goal-weighting (e.g. mental
  model over terminology); it's living — adapt in place, don't silently overwrite the why.
- **`progress`** — status is **qualitative and judged against the learner's goal** (understanding
  the mechanism with fuzzy terminology can be "working"/"solid" if names aren't the goal); it's a
  **present-state snapshot, not a decay model**; seed it from the probe; append narrative to the
  session-log attachment, not the card body.

### The skill (the cross-card process)

**`build-unit`** (provisional name) — the boxholder's 7-step authoring/teaching flow, which is the
heart of "guide the agent through a pedagogically grounded process." Not a rigid pipeline; probing
comes early and the rest follows from it.

1. **Probe — interactively, by default.** Open-ended, anchored in a concrete familiar phenomenon,
   aimed at the mental model ("what's actually happening when you mix baking soda and vinegar?").
   Draw out understanding *and* misconceptions, in the learner's own terms — about the topic *and*
   adjacent territory. (Clinical interview / conceptual-change.) **Two modes:** with a learner
   present → probe first and personalize; authoring for an unknown student → skip probing, build for
   a model learner, and probe later when a real one arrives.
2. **Build/refine the concept-map** — informed by the probe. Assign KC `kind`s; draw loose edges;
   record observed misconceptions; let genuine spirals be cycles.
3. **Seed & track progress** — write the present-state snapshot into a `progress` card from what the
   probe surfaced; keep it updated over time.
4. **Step back to the approach** — given the scope and the learner's *deeper* goals (which have
   emerged by now, not front-loaded as a form): what mental model are they really after? Set
   `emphasis` (e.g. principles over terminology).
5. **Choose modalities** — manipulatives, dialogs, conversations, worked examples… matched to the
   approach and the KC kinds.
6. **Write the plan, reasoning included** — populate `approach.decisions` with decision+rationale
   and the body; produce material in the chosen modalities under `material/`, answer keys alongside.
7. **Adapt as you go** — adaptation is expected and a good sign; it reads the recorded rationale and
   extends it rather than overwriting.

The skill also owns: the probe technique, the two modes, and the cross-card sequencing — none of
which belongs in any single card-rule.

### Track order

1. **Skill-home probe** (verify box `.claude/skills/` discovery → decide A1 box-skill via a new
   `generateSkills` mirroring `generateRules`, vs A2 always-on rule + CLAUDE.md pointer).
2. **`concept-map`** schema + `validate` + rule + template (locks node/edge vocabulary).
3. **`unit`** schema + rule + template; **ensure embedded attached cards get first-class bulk
   validation/indexing** (the must-verify item).
4. **`approach`** and **`progress`** schemas + rules + templates.
5. **`build-unit` skill** authored in the Track-1 home; pointers wired into each card-rule.

## Subplans

**Candidate:** if Track 3's "first-class embedded cards" turns out to need real work in the
validate/index/render paths (not just a config tweak), spin `courseware-embedded-cards.subplan.md` —
it's a general box capability (any card-owning-cards pattern would use it), conceptually separate
from courseware. Held inline pending the Track-1/3 findings.

**Candidate:** box skills-provisioning (Track 1 A1), if it grows past a thin `generateSkills`.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `concept-map` `related.to` → missing node id; duplicate node id | Will add (validate doctest) | **Yes — `validate` hook** (`schema.ts:104`) | Clear (warning naming the id) |
| `complements` cycle | n/a — not a failure | Intentional | n/a (valid) |
| `unit` references a component card that isn't there (typo / not yet built) | Will add | Yes — ref lint warning (`ref-exists.ts:68`) | Clear (warning) |
| **Embedded concept-map/approach NOT validated in bulk** (attach treated as assets) | Track-3 verification | **Must-ensure** — per-file edit hook covers edits; bulk is the gap | **Silent** until ensured |
| `progress.entries[].node` → a node id not in the unit's map | Will add | Partial — cross-card; lives in `card-lint.ts`, not the self-contained hook | Warn (if added to lint) / else silent |
| Half-built unit/approach/progress (empty fields) | Will add (parse doctest) | Yes — all-optional + lenient parse | Clear (loads) |
| Agent fabricates misconceptions/concepts not observed; or overwrites approach rationale | No | Partial — card-rules ("observed only", "keep reasoning in") | Silent (honesty/process risk) |
| Box skill not discovered (A1 wrong) | Track-1 probe is the test | A2 fallback | Clear (caught pre-ship) |

> **Critical gap:** the embedded-card bulk-validation gap is the one real risk — if `.attach/`
> cards aren't bulk-validated, a broken concept-map embedded in a unit could sit unflagged until
> someone edits it. **Resolution:** Track 3 verifies and, if needed, makes attached `.card` files
> first-class in the validate/index walk (or the design moves components to *co-located sibling*
> cards, which are already first-class — the fallback noted in Open Questions).

## Agent-flow / user-flow edge cases

- **Wrong field/shape** — relation as a bare string; misconception under `related`; status outside
  the enum. **ADDRESSED** — Zod rejects at parse; card-rules give field-by-field examples.
- **Stale ref** — intra-graph edges are node ids (travel inside the card) → **N/A**; unit→component
  and progress→unit are refs → warned (`ref-exists.ts:68`). Embedding components keeps unit→component
  refs stable under moves (they move together).
- **Two agents on one unit / progress** — last-write parse-mutate-reserialize, same as all cards.
  **DEFERRED** (no new surface).
- **Hand-edit drift** — unknown key stripped + warned (`schema.ts:206-213`); `validate` also catches
  a hand-introduced dangling edge id.
- **Fabricated value / lost rationale** — **GAP (by design)** — card-rules make honesty and
  rationale-keeping the low-friction path; not mechanically enforced. Accepted limit of a prose-first
  model.
- **Validation UX** — `validate` returns `LintIssue[]`; phrase issues with the offending id.
  **ADDRESSED** (impl note).
- **Partial migration** — none; net-new types. **ADDRESSED.**

## NOT in scope

- **The Phase-2 tutoring *runner*** — the skill that conducts ongoing teaching sessions over
  material (Socratic delivery, retrieve-don't-leak answer keys, follow the learner's work). Phase 1
  *builds* the unit and *probes* (which is teaching-shaped), and seeds progress; running repeated
  lessons is next.
- **Rich material/activity authoring as new card types** — material is existing presentational cards
  in a subdir; no new material schema.
- **Multi-unit courses / a shared cross-unit learner profile.** The boxholder's "mental model of the
  world" goal spans units and argues for a shared learner profile eventually — Phase 1 captures the
  unit-specific slice in `approach`/`goals` and notes the factor-out. Stay at unit scale now.
- **Numeric mastery, forgetting/decay, spaced review** — rejected for the direction.
- **A custom frontend renderer** — default frontmatter-card view for now.

## Open design questions

- **Naming.** `unit` (provisional) and `approach` (provisional). `unit` is the boxholder's word but
  generic; alternatives `course`/`tutorial`/`study`. `approach` vs `plan`/`pedagogy`/`teaching-plan`.
  `concept-map` and `progress` are settled. *Lean:* keep `unit` and `approach` unless a clearly better
  term surfaces.
- **Skill home (Track 1): A1 box-skill vs A2 always-on rule.** *Lean:* A1 if box skills are
  auto-discovered; verify first.
- **Embedded attached cards vs co-located sibling cards.** The boxholder wants attached-cards-as-real-
  cards. *Lean:* pursue attachment and make it first-class (Track 3); if that's costly, fall back to
  co-located siblings (same dir, relative ref) — same "travels together," already first-class, minus
  the asset-scope semantics.
- **Does `progress.entries[].node` integrity (a cross-card check) warrant a `card-lint.ts` rule, or
  is a stale node id tolerable?** *Lean:* add a gentle lint warning later; tolerable in Phase 1.
- **`approach` as its own embedded card vs a section of `unit`.** *Lean (settled in discussion):* its
  own card — substantial, living, re-read constantly.

## Knowledge audits

New agent-facing concepts → at least one `knows_directly` audit each in
`callback-box/src/dev/knowledge-audits.yaml`:

- **Unit composition** — a `unit` binds an embedded concept-map + approach + a `material/` subdir;
  progress is a *separate* card.
- **concept-map** — in-card nodes, node-id edges, KC `kind` drives teaching, **cycles are intended**.
- **approach** — keep the reasoning in; `emphasis` records the learner's goal-weighting; adaptation
  reads rationale.
- **progress** — qualitative, **present-state not decay**, judged against the learner's goal; session
  log is an attachment.
- **The authoring flow exists** — building a unit means following the courseware process (probe-first,
  phenomenon-anchored), not writing cards cold.

Land **run**: `pnpm knowledge-audit run --box <abs-path-to-test-box> --filter courseware` before the
plan completes (`--box` must be an absolute path or omitted). No skip-with-rationale.

## Implementation order

1. **Skill-home probe** → A1/A2 decision. (Unblocks the skill; blocks nothing else.)
2. **`concept-map`** — read `lint-format.ts`; schema + `validate` + rule + template + parse/validate
   doctests. Locks node/edge vocabulary.
3. **`unit`** — schema + rule + template + `BOX_DIRS` (`courses: "store/courses"`); **verify/ensure
   embedded `.card` bulk validation** (the must-ensure item; may trigger the subplan).
4. **`approach`** + **`progress`** — schemas + rules + templates + parse doctests; progress's
   session-log attachment convention documented.
5. **`build-unit` skill** — authored in the Track-1 home; pointers wired into each card-rule.
6. **Knowledge audits** — written, run against the test box, status recorded.

One/few commits per item on the worktree branch. The plan completes when all land; it ships (merges
to main) only on the boxholder's explicit signal.

## Rollout shape

- **Tests** (per `docs/testing.md` — first as a design tool, on substantial codepaths):
  - Parse doctests per type — valid round-trips; enums reject bad values; all-optional fields let
    half-built cards load.
  - `concept-map` `validate` doctest — dangling/duplicate node id → `LintIssue`; cycle → none; clean
    map → silent.
  - One embedded-card doctest — a concept-map inside a unit's `.attach/` is bulk-validated (the
    must-ensure behavior), proving Track 3.
  - No tests for the skill prose — the knowledge audits are its verification.
- **Knowledge-audit entries** — the five above land run.
- **Migration** — none; net-new types + `BOX_DIRS` key + skill/rule assets. `cb init` regenerates
  rules (and skills, if A1) idempotently (`init-rules.ts:69-85`).

## Named future phases

- **Phase 2 — the tutoring runner.** A skill that conducts repeated teaching sessions over a unit's
  material: Socratic delivery, answer keys retrieved-not-leaked, follow the learner's actual work,
  update progress and the session log each sitting.
- **Phase 3 — shared learner profile.** Factor the cross-unit "who the learner is and what mental
  model they're building" out of individual units into a profile each unit reads from and feeds.
- **Phase 4 — gentle review & richer material.** Conversation-native re-checks tied to nodes; more
  material modalities. No numeric engine — consistent with the Phase-1 stance.
- **Later, if ever — multi-unit courses.** A wrapper ordering several units, only if unit scale proves
  too small in practice.

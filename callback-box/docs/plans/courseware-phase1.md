# Courseware Phase 1 — the course: cards, rules, and the authoring skill

This plan introduces a "courseware" card family centered on one container — a
**course** — that an agent builds *with* a learner through a
pedagogically-grounded process. A course binds a few components: a **concept-map**
(the knowledge graph), an **exposition-plan** (the plan for *presenting* the material —
reasoned from the goals, the learner, and the available ways to present — with the why kept
in), **material** (presentational content, in a subdirectory), and —
tracked separately per learner — **progress** (an *evidence-backed* qualitative
record of what the learner understands, with a session log).

The governing reframe holds throughout: **in callback-box the agent is the
tutoring engine; cards are the durable models.** No numeric ITS runtime (no BKT,
IRT, or FSRS). We persist a small, qualitative, research-grounded data model and
put the pedagogical discipline where it belongs — see *Division of labor* below.

This revision folds in a cross-model (Codex) review (see
`courseware-phase1.review` notes inline); the load-bearing change is that
**every progress rating must cite the evidence and probe that produced it** —
the one guard against an LLM confidently authoring a beautiful course it never
checked against the learner.

## Division of labor: cards vs card-rules vs skills

The whole design is organized across the three surfaces the work lives on. Being
explicit about which knowledge goes where is the spine of this plan:

- **Cards** hold *structure and state* — the graph, the exposition-plan-with-rationale,
  the progress record, the course manifest. Durable data, schema-validated.
- **Card rules/docs** — each schema's `instructions`, auto-published by
  `generateRules` to `.claude/rules/card-<type>.md` (`init-rules.ts:99-114`),
  loaded *automatically* when the agent reads or edits a card of that type. These
  hold *per-type handling*: field semantics, invariants ("cycles are fine," "keep
  the reasoning in," "no status without evidence," the edge-type rubric), and
  lifecycle. Not process — handling.
- **Skills** hold the *cross-card process* — the multi-step authoring/teaching
  flow, the probing technique, the two authoring modes. Invoked (not
  path-triggered), they orchestrate work *across* the cards. This is where the
  "guide the agent through a thorough, pedagogically grounded process" requirement
  is satisfied.

Rule of thumb: if guidance is about *one card type in isolation*, it's a
card-rule; if it spans cards or is a sequenced procedure, it's the skill; if it's
data, it's a field. **The card-rules can't bootstrap authoring** (they only load
once a card of that type already exists — `init-rules.ts:102`), so the skill is
the primary entry point and must be reliably invokable — **confirmed: box-level
`.claude/skills/` are auto-discovered by the box agent (Track 1, verified).**

> **Review gate:** the boxholder reviews the authored skill(s) and their prompts
> before they ship. Skill/prompt text lands for review, not auto-merged.

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md` → **"Read before writing. Don't guess file formats…"** —
  every schema/registration/attach claim cites the file it was read from.
- `callback-box/CLAUDE.md` → **"Keep source and docs generic — never hardcode personal
  names…"** — instructions and the skill stay generic ("the learner").
- `callback-box/CLAUDE.md` (Cards) → **"Schemas can include `instructions`… injected into
  agent context when processing cards of that type."** — the card-rules surface; **and
  "filename supplies the type — there is no `type:` field"** (`CLAUDE.md:39`), so templates
  must not emit `type:`.
- `callback-box/CODE-STYLE.md` → **"No default parameters"**, **"Max 2 positional
  parameters"**, **"NEVER use `any`"**, double quotes, semicolons.
- `callback-box/CLAUDE.md` → **"don't add features beyond what the task requires."** — the
  qualitative, prose-first stances are the scope guardrail; the *new* required fields
  (evidence, edge `kind`) earn their place by closing a named failure mode, not by adding
  rigor for its own sake.
- Precedents: **`LandmarkSchema`** (`landmark.ts`) for instruction voice and `create*Template`;
  the **`validate` hook contract** (`schema.ts:104-128`) **plus working examples in
  `commentary.tsx:62` and `extfile.tsx:69`** to copy; the **`.attach/` convention**
  (`attach-path.ts`) for embedded components.

## What already exists

- **Card-type primitive** — `cardSchema(type, { fields, instructions?, searchable?, validate? })`
  (`schema.ts:165`); one body field via `body()` (`schema.ts:52`); globals auto-injected
  (`schema.ts:87`). **Reuse** for all four new types.
- **Self-contained `validate` hook** — sees only the card's own data (`schema.ts:104-128`).
  Working precedents: `commentary.tsx:62`, `extfile.tsx:69`. **Reuse** — the concept-map's
  intra-card integrity (unique ids; every edge `to` resolves) validates here. Cross-card
  checks (progress→map node ids) do **not** fit here — they go in `card-lint.ts` (below).
- **Lenient parse** — unknown keys stripped + warned; missing-required/wrong-type fails
  (`schema.ts:206-213`). **Reuse** — keep required fields minimal, but note: the few fields we
  *do* require (evidence/basis on a progress entry, `kind` on an edge) will fail-to-parse if
  omitted. That's intended — a rating without evidence or an unlabeled edge is exactly what we
  refuse to store.
- **Ref convention** — keys named `ref`/`refs` are cross-card edges (`extractRefs`,
  `schema.ts:240`); resolution relative / box-root-absolute / attach-scope (`ref-exists.ts:52-61`);
  broken refs are lint **warnings** (`ref-exists.ts:68`), and `cb validate` exits nonzero only on
  **errors** (`validate.ts:364`). **Reuse**, but see Failure modes: a warning is not a block.
- **`.attach/` convention** — every card may own a sibling `<basename>.attach/`; refs in use
  `attach/…` (`attach-path.ts`). Cards inside an attach scope are first-class: `cb validate --all`
  globs `**/*.card` with **no `.attach` ignore** (`list-cards.ts:12`, `validate.ts:245`), and
  search includes them (`search/walk.ts`); asset-manifest scanning skips `.card` files on purpose
  (`asset-manifest-scan.ts:90`). **So embedded concept-map/exposition-plan cards are bulk-validated,
  indexed, and rendered like any card** — the earlier "must-ensure gap" was unfounded (Codex
  finding #5, verified). A standalone card with no attachments is simply a single file.
- **`instructions` → box rule** — `generateRules(boxRoot)` writes path-globbed
  `.claude/rules/card-<type>.md`, idempotent (`init-rules.ts:65-114`). **Reuse** for all four
  types.
- **Schema registration** — `cardSchemas[]` in **`src/schemas/registry.ts:54`**; template
  registry (`templates-builtins.ts:28`); `BOX_DIRS` (`paths.ts:24`). Hyphenated type names work.
  **Reuse.**
- **Box-aware lint** — `card-lint.ts` already does the box-aware ref-existence walk
  (`card-lint.ts` ~135-169). **Reuse/extend** — the new progress→map node-id check lives here, not
  in the self-contained `validate` hook.

- **Box-level skills ARE discovered (Track 1, verified empirically).** The box agent runs via
  `@anthropic-ai/claude-agent-sdk` `^0.2.128` with `cwd = boxRoot` and the default
  `settingSources: ["user","project"]` and **no explicit `skills` option** (`agent-run.ts:55-86`).
  A throwaway `<box>/.claude/skills/cw-probe/SKILL.md` was listed by the agent when run via
  `cb prompt` (the exact box environment) — so a project-level skill dropped into the box is
  discovered and invocable with **no SDK-option change**. (The old 0.1.x discovery bug is moot at
  0.2.128.) **Decision: A1.**

Net-new:

- **Box skills-provisioning (`generateSkills`)** — boxes get `.claude/rules/` +
  `.claude/settings.json` but no `.claude/skills/` yet, so a `cb init` step must *install* the
  courseware skill into the box (mirroring `generateRules`, `init-rules.ts:65`). Lands with the
  skill itself (Track 5) so the mechanism is built against a real, reviewed payload rather than an
  empty conveyor.
- **The progress→concept-map node-id lint** — a new box-aware check in `card-lint.ts`.

## Prior art (external)

What's kept from the research (subset compatible with a qualitative, learner-centric design):

- **Knowledge Components & KLI** (Koedinger et al. 2012) — KC *types* differ in how they're
  learned → node `kind` (`fact|concept|procedure|principle`) is **a strong hint** to the agent,
  not the sole driver of teaching (Codex #9: teaching also depends on prior knowledge, transfer
  goal, feedback, practice, misconception evidence). https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1551-6709.2012.01245.x
- **Bloom's revised taxonomy** — optional per-node `depth`; guidance, not enforced.
- **Spiral curriculum** (Bruner) — concepts bootstrapped together → the `complements` edge +
  permitted cycles. *Why we rejected a strict DAG.* https://helpfulprofessor.com/spiral-curriculum/
- **Backward design / UbD** — name the destination first. The course's `success-criteria` is the
  destination; it's defined early and used to **focus the goals and prune the graph**, then to
  judge advancement. Personalized, prose — *not* ABCD measurable objectives.
- **Observable success criteria ≠ measurable-objective bureaucracy** (Codex #2) — "explain why
  the balloon inflates without naming every ion" is a learner-specific success criterion, not a
  standardized objective. Adopted as `success-criteria`.
- **Clinical interview / conceptual-change probing** (Piaget; predict-then-explain;
  anchoring-phenomenon) — the probe technique: open-ended, anchored in a familiar phenomenon,
  aimed at the mental model. Surfaces misconceptions.
- **Formative assessment / evidence-based judgment** — a status claim must rest on observed
  learner evidence, against LLM over-crediting & sycophancy (Codex #1, and the documented
  sycophancy/answer-leak failure modes in LLM tutors). Drives the progress evidence contract.
- **Living learning contract** (Knowles) — goals emerge through dialogue, stay renegotiable →
  living rationale in `exposition-plan` + course body.
- **Khanmigo's lessons** — retrieve-don't-invent answer keys; privately enumerate the learner's
  likely solution paths; stay Socratic. Answer keys live *with material*; the minimal honesty
  protocol (below) brings the "don't leak / don't fabricate / don't sycophantically rate"
  discipline into Phase 1 even though the full runner is Phase 2 (Codex #3).
  https://blog.khanacademy.org/khanmigo-math-computation-and-tutoring-updates/

**Rejected on purpose:** ABCD/Mager *measurable objectives* that normalize a standardized learner
(but we keep *casual, personalized* success criteria — Codex #2 distinguishes these); a strict
prerequisite **DAG** (falsifies real spirals); numeric mastery **and any forgetting/decay model**
(rustiness is a 30-year starting condition, not on-timescale — the probe reads present state); a
global cross-course concept graph; an "other"/freeform edge type (edges must commit to a clear
`kind`).

**Library search:** only Zod and Claude Code's `.claude/` conventions are in play; nothing
non-obvious asked of either — flagged, not omitted. The one external unknown is box-level skill
discovery (Track 1).

## Tracks / scope

### The cards

Four new types. Lightweight and prose-first, with a *small* set of required fields that each
close a named failure mode.

**1. `course`** — the manifest/container. (Provisional name.)

```typescript
const ComponentRef = z.object({ ref: z.string() });
const courseFields = {
  goals: z.array(z.string()).optional(),            // the learner's deeper "why"; refined through probing
  "success-criteria": z.array(z.string()).optional(), // casual, personalized "what success looks like";
                                                      // set EARLY — focuses the goals and prunes the graph,
                                                      // then judges advancement (backward design)
  "concept-map": ComponentRef.optional(),           // → attach/<…>.concept-map.card
  "exposition-plan": ComponentRef.optional(),                // → attach/<…>.exposition-plan.card
  material: z.string().optional(),                  // subdirectory under the course's attach scope
  progress: ComponentRef.optional(),                // optional — progress may live here OR in a separate tree
  body: body(z.string()),                           // framing narrative + rationale; living
};
```

**2. `concept-map`** — the knowledge graph, embedded under the course.

```typescript
const ConceptKind = z.enum(["fact", "concept", "procedure", "principle"]);              // KC type — a strong hint
const BloomDepth = z.enum(["remember","understand","apply","analyze","evaluate","create"]); // optional
const RelationKind = z.enum([                       // CLOSED set; no "other"; every edge commits to one
  "prerequisite",            // B can't be grasped without A → sequence A first; on struggle with B, revisit A
  "complements",             // A and B reinforce each other, learned together → spirals/cycles live here
  "contrasts-with",          // A and B clarified by comparison → teach the distinction
  "applied-in",              // A (principle/procedure) put to work in B → ground the abstract, show transfer
  "commonly-confused-with",  // learners conflate A and B → do an explicit disambiguation
]);
const ConceptRelation = z.object({ to: z.string(), kind: RelationKind });               // `kind` REQUIRED
const ConceptNode = z.object({
  id: z.string(), name: z.string(), kind: ConceptKind,
  gloss: z.string().optional(), depth: BloomDepth.optional(),
  misconceptions: z.array(z.string()).optional(),
  related: z.array(ConceptRelation).optional(),     // edges optional; but any edge present is fully typed
});
const conceptMapFields = { concepts: z.array(ConceptNode), body: body(z.string()) };
// validate(): unique ids; every related.to resolves to a node id. Cycles are NOT errors.
```

**3. `exposition-plan`** — the plan for how to *present* the material: all aspects of the exposition,
reasoned from the goals, what's known about the learner/audience, and the available ways a thing can be
presented (modalities), with the *reasoning kept in*. It is the **plan**, not the rendered exposition —
that lives in `material/`. A single-file card embedded as `<Course>.attach/<Name>.exposition-plan.card`.
Kept as a dedicated type (not a `doc`) so its card-rule can carry the "keep the reasoning in" discipline.
(General beyond courseware — any deliberate presentation, e.g. slides, a blog post — could use it.)

```typescript
const Modality = z.object({ name: z.string(), why: z.string().optional() });   // manipulatives, dialogs, worked-examples+fading, transfer prompts, reflection…
const Decision = z.object({ decision: z.string(), rationale: z.string() });     // so adaptation respects WHY
const expositionPlanFields = {
  emphasis: z.array(z.string()).optional(),   // weighting from the learner's goal, e.g. "principles over terminology"
  modalities: z.array(Modality).optional(),   // chosen formats + why
  decisions: z.array(Decision).optional(),    // decisions + rationale (load-bearing)
  body: body(z.string()),                     // the plan narrative + reasoning; living, adapted in place
};
```

**4. `progress`** — a per-learner, **evidence-backed** qualitative record, kept *separate* (its own
card; may live in another tree). Session log is a plain attached file.

```typescript
const NodeStatus = z.enum(["unfamiliar", "partial", "working", "solid"]);   // qualitative; judged vs success-criteria
const EvidenceBasis = z.enum(["observed", "inferred", "self-report"]);      // how the rating was reached
const ProgressEntry = z.object({
  node: z.string(),                       // concept-map node id (box-aware lint checks it resolves)
  status: NodeStatus,
  basis: EvidenceBasis,                   // REQUIRED — no anonymous ratings
  evidence: z.array(z.string()),          // REQUIRED — the learner's actual words/work + the probe used
  "last-assessed": z.string().optional(),
  "next-probe": z.string().optional(),    // what would test or change this rating
  misconception: z.string().optional(),   // an active misconception to address, if any
});
const progressFields = {
  course: ComponentRef.optional(),          // the course this tracks (often a cross-tree ref)
  learner: z.string().optional(),
  entries: z.array(ProgressEntry).optional(),  // seeded by the probe; evolving
  body: body(z.string()),                 // running summary; the session log lives in <basename>.attach/
};
```

**Material is not a new card type** — existing presentational cards (`doc`, `webpage`, `image`, …)
in the course's `attach/material/` subdirectory, with answer keys alongside.

**Vocabulary lock-ins:** the four type names; node `id`/`kind`/`depth`/`related`/`misconceptions`;
edge `to`/`kind` (the five-value closed set, **required**); progress `status`
(`unfamiliar|partial|working|solid`), **required `basis` + `evidence`**; course `success-criteria`;
`exposition-plan.decisions[].rationale`.

### The card rules/docs (each schema's `instructions`)

Written in the `landmark.ts:124-163` voice. What each must convey:

- **`course`** — a container; components are embedded attached cards (concept-map, exposition-plan) + a
  `material/` subdir; progress may live here or separately; `success-criteria` is set early and is
  the lens for what belongs in the graph; reuse existing components by ref, don't duplicate.
- **`concept-map`** — in-card nodes; node-id edges (not file refs); `kind` is a strong hint to how
  to teach (fact→retrieval, procedure→worked-examples+fading, principle→sense-making) **but not the
  whole story**; **cycles are intended** (spirals); surface only observed misconceptions. **Carries
  the edge-type rubric verbatim** (the five `kind`s + when to use each); every edge must pick one —
  there is no "other."
- **`exposition-plan`** — plan *all* aspects of how the material is presented, reasoning from the goals,
  what's known about the learner, and the available ways to present (modalities); it's the **plan**, not
  the rendered output (`material/`). **Keep the reasoning in**: each decision carries its rationale so
  adaptation stays coherent; `emphasis` records the learner's goal-weighting; consider transfer prompts
  and metacognitive reflection among modalities; it's living — adapt in place, don't overwrite the why.
- **`progress`** — **no status without evidence**: every entry cites the learner's actual
  words/work and the probe used, with `basis` and (ideally) a `next-probe`; status is qualitative
  and judged **against the course's `success-criteria`** (understanding the mechanism with fuzzy
  terminology can be "solid" when names aren't the goal); it's a **present-state record, not a decay
  model**; append narrative to the session-log attachment, not the card body; **don't
  sycophantically upgrade a rating** when the learner sounds confident — rate the evidence.

### The skill (the cross-card process)

**`build-course`** (provisional) — the boxholder's authoring/teaching flow. Not a rigid pipeline;
probing comes early and the rest follows. **Lands for boxholder review before shipping.**

1. **Probe — interactively, by default.** Open-ended, anchored in a concrete familiar phenomenon,
   aimed at the mental model ("what's actually happening when you mix baking soda and vinegar?").
   Draw out understanding *and* misconceptions in the learner's own terms — topic *and* adjacent.
   **Two modes:** learner present → probe first, personalize; unknown student → skip probing, build
   for a model learner, probe later.
2. **Set `success-criteria`** — casual, personalized "what would count as understanding this for
   *you*." Use it to focus the goals and decide what belongs in the graph (backward design).
3. **Build/refine the concept-map** — KC `kind`s; **typed** edges (pick from the rubric); observed
   misconceptions; let genuine spirals be `complements` cycles.
4. **Seed & track progress — with evidence.** Each rating cites what the learner actually said/did
   and the probe; set `basis` and a `next-probe`. Update over time.
5. **Step back to the exposition-plan** — given scope + the learner's deeper goals (now emerged): set
   `emphasis` (e.g. principles over terminology); choose modalities (manipulatives, dialogs,
   worked-examples + fading, transfer prompts, reflection).
6. **Write the plan, reasoning included** — populate `exposition-plan.decisions` (decision + rationale) and
   body; produce material under `material/`, answer keys alongside.
7. **Adapt as you go** — expected and good; reads the recorded rationale and extends it.

**Minimal honesty protocol (Phase 1, even before the full runner — Codex #3).** The skill's probing
and any teaching turn must: never reveal an answer the learner is working toward (retrieve the key,
don't emit it); follow the learner's *actual* words/work rather than an idealized path; never
fabricate a misconception or a concept the learner didn't exhibit; and never upgrade a status the
evidence doesn't support. **Session-log format:** each sitting appends to the progress card's
`<basename>.attach/` log — timestamp, what was covered, the learner's notable utterances/work,
ratings changed (with the evidence), and what to pick up next.

### Track order

1. **Skill-home — DONE (A1).** Verified empirically that box `.claude/skills/` are auto-discovered
   (above). No SDK change. The `generateSkills` install step lands with the skill in Track 5.
2. **`concept-map`** — schema + `validate` + rule (incl. the edge rubric) + template.
3. **`course`** — schema + rule + template.
4. **`exposition-plan`** + **`progress`** — schemas + rules + templates; **plus the progress→map node-id
   box-aware lint in `card-lint.ts`** and the session-log convention.
5. **`build-course` skill** + the honesty protocol — authored as a box skill (A1), plus the
   **`generateSkills` install step** in `cb init` that writes it into `<box>/.claude/skills/`;
   pointers wired into each card-rule. **Boxholder reviews the skill/prompts before ship.**

## Subplans

**Candidate:** box skills-provisioning (Track 1 A1), if it grows past a thin `generateSkills`.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `concept-map` edge `to` → missing node id; duplicate node id | Will add (validate doctest) | **Yes — `validate` hook** | Clear (warning naming the id) |
| Edge with no/invalid `kind` | Will add (parse doctest) | Yes — `kind` required enum, parse fails | Clear (parse error) |
| `complements` cycle | n/a — not a failure | Intentional | n/a (valid) |
| **Progress status with no evidence / no basis** | Will add (parse doctest) | **Yes — `evidence`+`basis` required**, parse fails | Clear (parse error) — the core guard |
| `progress.entries[].node` → id not in the course's map | Will add (lint doctest) | **Yes — new box-aware lint in `card-lint.ts`** (Codex #4: not "tolerable") | Clear (warning) |
| `course` references a component card that isn't there | Will add | Ref lint **warning** only; `cb validate` won't block (`validate.ts:364`) | Clear but non-blocking — see below |
| Embedded concept-map/exposition-plan not bulk-validated | n/a — **not a gap** (`list-cards.ts:12` globs into `.attach`) | Yes — first-class | Clear |
| Half-built course/exposition-plan (optional fields empty) | Will add | Yes — lenient parse | Clear (loads) |
| Agent fabricates evidence/misconceptions, or sycophantically rates "solid" | No (not mechanically detectable) | Partial — required `evidence`+`basis` raise the cost; the honesty protocol + progress rule | Silent (honesty risk, much reduced) |

> **No critical gaps.** The two earlier worries are resolved: embedded-card validation is not a gap
> (verified), and progress→map integrity is now a real box-aware lint, not "tolerable." The residual
> silent risk — *fabricated* evidence — can't be closed by a schema; the evidence contract makes
> honesty the low-friction path and makes a bare assertion impossible to record.
>
> **Acceptable non-block:** a new course can be "complete" with a dangling component ref (warning, not
> error). If that proves too loose, add a courseware-specific completeness check that a course's
> `concept-map`/`exposition-plan` resolve before it's considered ready (Codex #6) — deferred.

## Agent-flow / user-flow edge cases

- **Wrong field/shape** — edge as a bare string; misconception under `related`; status/`basis`
  outside the enum; an edge missing `kind`. **ADDRESSED** — Zod rejects at parse; rules give
  examples + the edge rubric.
- **Stale ref** — intra-graph edges are node ids (travel inside the card) → N/A; course→component and
  progress→course are refs → warned; progress→node is the new box-aware lint.
- **Two agents on one course/progress** — last-write parse-mutate-reserialize, same as all cards.
  **DEFERRED.**
- **Hand-edit drift** — unknown key stripped + warned; `validate` catches a dangling edge id; a
  hand-added evidence-less progress entry fails to parse.
- **Fabricated value / lost rationale / sycophantic rating** — **GAP, much reduced** — required
  evidence/basis + the honesty protocol + the progress rule make honesty the path of least
  resistance; not fully enforceable. Accepted.
- **Validation UX** — `validate`/lint return `LintIssue[]`; phrase issues with the offending id.
- **Partial migration** — none; net-new types.

## NOT in scope

- **The Phase-2 tutoring *runner*** — the skill that conducts ongoing teaching sessions over
  material. Phase 1 *builds*, *probes*, and seeds evidence-backed progress, and carries the
  *minimal* honesty protocol + session-log format; repeated-session delivery is next.
- **Rich material/activity authoring as new card types** — material is existing presentational cards.
- **Multiple courses / a shared cross-course learner profile** — the "mental model of the world" goal
  spans courses (Phase 3); Phase 1 captures the course slice and notes the factor-out.
- **A `BOX_DIRS.courses` directory** — dropped (Codex "what I'd cut" + boxholder agree): courses can
  live in any tree via refs; add a storage dir only when navigation needs one.
- **Numeric mastery, forgetting/decay, spaced review** — rejected for the direction.
- **A custom frontend renderer** — default frontmatter-card view for now.

## Open design questions

- ~~**Skill home (Track 1): A1 vs A2.**~~ **Resolved: A1** — box skills are auto-discovered
  (verified). `generateSkills` install step lands with Track 5.
- **`exposition-plan` as a dedicated type vs a `doc` card.** *Lean (chosen):* dedicated type — its card-rule
  carries "keep the reasoning in," which a `doc` wouldn't. Collapse to `doc` only if the light
  structure (`emphasis`/`modalities`/`decisions`) proves unused.
- **Naming.** Settled: container **`course`**, presentation-plan card **`exposition-plan`**. (Other
  card names — `concept-map`, `progress` — also settled.)
- **`success-criteria`: course-level only, or also per-node?** *Lean:* course-level in Phase 1 (the
  focusing lens); add per-node only if advancement decisions need finer grain.

## Knowledge audits

New agent-facing concepts → at least one `knows_directly` audit each in
`callback-box/src/dev/knowledge-audits.yaml`:

- **Course composition** — a `course` binds an embedded concept-map + exposition-plan + a `material/` subdir;
  progress is a *separate*, evidence-backed card.
- **concept-map** — in-card nodes, node-id edges, **`kind` required from the closed five**, cycles
  intended; `kind` is a hint not the whole story.
- **Edge rubric** — can the agent pick `prerequisite` vs `commonly-confused-with` vs `applied-in`
  correctly from a described pair?
- **exposition-plan** — keep the reasoning in; adaptation reads rationale.
- **progress evidence contract** — **no status without evidence + basis**; rate the evidence, not the
  learner's confidence; present-state not decay; judged against `success-criteria`.
- **The authoring flow** — building a course means following the courseware process (probe-first,
  phenomenon-anchored), not writing cards cold.

Land **run**: `pnpm knowledge-audit run --box <abs-path-to-test-box> --filter courseware` before the
plan completes (`--box` absolute or omitted). No skip-with-rationale.

## Implementation order

1. **Skill-home probe** → ✅ done, A1 (box skills auto-discovered, verified). `generateSkills`
   install step folded into step 5.
2. **`concept-map`** — read `lint-format.ts` + the `commentary.tsx`/`extfile.tsx` validate hooks;
   schema + `validate` + rule (with the edge rubric) + template + parse/validate doctests.
3. **`course`** — schema + rule + template + parse doctest.
4. **`exposition-plan`** + **`progress`** — schemas + rules + templates + parse doctests; the
   progress→map node-id check in `card-lint.ts` + its lint doctest; session-log convention.
5. **`build-course` skill** + honesty protocol — authored as a box skill (A1) + the `generateSkills`
   install step in `cb init`; pointers wired in. **Boxholder review before merge.**
6. **Knowledge audits** — written, run, recorded.

One/few commits per item on the worktree branch. Completes when all land; ships only on the
boxholder's explicit signal.

## Rollout shape

- **Tests** (per `docs/testing.md`):
  - Parse doctests per type — valid round-trips; enums reject bad values; **a progress entry without
    `evidence`/`basis` fails**; **an edge without `kind` fails**; other optional fields let half-built
    cards load.
  - `concept-map` `validate` doctest — dangling/duplicate node id → `LintIssue`; cycle → none.
  - `card-lint` doctest — a `progress` entry whose `node` isn't in the course's map → warning; a valid
    one → silent.
  - Embedded-card doctest — a concept-map inside a course's `.attach/` is bulk-validated (confirms the
    `list-cards.ts` behavior we rely on).
  - No tests for skill prose — the knowledge audits are its verification.
- **Knowledge-audit entries** — the six above land run.
- **Migration** — none; net-new types + skill/rule assets. `cb init` regenerates rules (and skills,
  if A1) idempotently.

## Named future phases

- **Phase 2 — the tutoring runner.** Repeated teaching sessions over a course's material: Socratic
  delivery, answer keys retrieved-not-leaked, follow the learner's actual work, retrieval practice,
  worked-examples + fading, immediate feedback, update progress + the session log each sitting.
- **Phase 3 — shared learner profile.** Factor the cross-course "who the learner is and what mental
  model they're building" out of courses into a profile each course reads from and feeds.
- **Phase 4 — gentle review & richer material.** Conversation-native re-checks tied to nodes; more
  material modalities; learner affect/frustration handling; metacognitive reflection prompts. No
  numeric engine.
- **Later, if ever — multi-course programs.**

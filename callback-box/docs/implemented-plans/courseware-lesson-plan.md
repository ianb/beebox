# Courseware: the `lesson-plan` card

> **Status: implemented** (2026-06-24). The schema lives in
> `src/schemas/lesson-plan.ts`, the generalized node-id + deferral lint in
> `src/core/lint-node-refs.ts`, the skill flow in `src/core/box-skills-content.ts`,
> and the audits in `src/dev/knowledge-audits.yaml`. This doc is the frozen design
> record; the present-tense reference is the card-rules those schemas generate.

Adds a `lesson-plan` card type to the courseware family — the **delivery-flow**
layer a course is currently missing: an ordered sequence of segments, each
either *interactive* (happens live in chat) or *material* (uses a pre-made
material card), tying the flow to the concept-map and the material. It also fixes
the material convention (proper presentational cards, not a stray `README.md`).

## Stated preferences this plan trades against

- `callback-box/CLAUDE.md` (Cards) — **"Schemas can include `instructions`… injected into agent
  context when processing cards of that type."** The card-rule surface this plan leans on.
- `callback-box/CLAUDE.md` — **"don't add features beyond what the task requires."** A lesson-plan
  is the *plan*, not the Phase-2 tutoring runner; keep the line.
- `callback-box/CLAUDE.md` — **"Keep source and docs generic — never hardcode personal names…"**
  Instructions stay generic; neutral pronouns (the courseware convention).
- `callback-box/CODE-STYLE.md` — no `any`, no default params, max 2 positional params, files ≤300
  lines (the reason courseware templates live in `templates-courseware.ts`, not `templates-builtins.ts`).
- The denser precedents are the **courseware cards themselves**: `concept-map.ts` (closed-enum
  fields + self-contained `validate`), `course.ts` (ComponentRef manifest), `progress.ts` (sparse,
  and the cross-card node-id lint), `exposition-plan.ts` (worked-process card). New choices trace
  to "match the courseware family's existing shape."

## What already exists

- **The card-type primitive + courseware family.** `cardSchema(type, { fields, instructions, validate? })`
  is the pattern; register in `src/schemas/registry.ts` (the `cardSchemas[]` array — courseware
  entries at `registry.ts:76-78`: `CourseSchema, ExpositionPlanSchema, ProgressSchema`), and add a
  template in `src/schemas/templates-courseware.ts` (`registerTemplate` with the shared `titleArgs`,
  `templates-courseware.ts:15-22`). **Reuse** — `lesson-plan` is one more entry in each.
- **The course manifest + ComponentRef.** `course.ts:19` `const ComponentRef = z.object({ ref: z.string() })`;
  `courseFields` (`course.ts:21-29`) already binds `"concept-map"`, `"exposition-plan"`, `material`,
  `progress`. **Reuse** — add a `"lesson-plan": ComponentRef.optional()` field + a card-rule line.
- **The cross-card node-id lint.** `lint-progress-nodes.ts:34` `lintProgressNodeRefs` walks
  progress → its `course` ref → the course's `concept-map` ref → node ids (`resolveRefToPath`
  `:41,:47`, `readCardYaml` `:42,:48`, `conceptNodeIds` `:85`), invoked from `card-lint.ts:171`
  (`if (type === "progress")`). The lesson-plan's `segments[].concepts` are the *same* kind of
  intra-card node-id reference. **Generalize, don't rebuild** — factor the course→concept-map→node-id
  resolution out of `lint-progress-nodes.ts` into a shared helper that takes a per-type node-id
  extractor; progress and lesson-plan both call it.
- **The generic ref walk.** `card-lint.ts` extracts any nested `ref`/`refs` and warns on broken
  ones. **Reuse** — a segment's `material: { ref: … }` is lint-checked for free; only the *node ids*
  need the box-aware check above.
- **The build-course skill.** `src/core/box-skills-content.ts` — step 6 "Produce the material"
  (`:74-76`) currently says only "Author the material under `material/`" and the trial improvised a
  `material/README.md`. **Modify** — add a lesson-plan step and make the material guidance concrete
  (cards, not a README).
- **Existing presentational card types.** `doc` (written recaps), `figure` (interactive
  manipulables — the merge added it, p5/three/d3). **Reuse** — material is these; **no new material
  schema.**
- **The concept-map renderer** (`src/frontend/src/components/concept-map/`) is the precedent if a
  lesson-plan renderer is ever wanted. **Not reused now** (see NOT in scope).

## Prior art (external)

This is an internal card schema; no third-party library is in play, so there's no
library-limitation or bug search to run — flagged rather than skipped. The *concept* —
a lesson plan as an ordered sequence of activities, some teacher-led/live and some
material-backed — is standard instructional design (a "lesson plan" / "learning sequence"
with activity types), the same body of practice the rest of courseware already draws on
(backward design, etc.). No external pattern needs importing beyond that; the shape is
dictated by fit with the existing courseware cards, not by an outside framework.

## Tracks / scope

One coherent track; the chunks land in order.

### The `lesson-plan` card type

**What.** A new course-component card holding the ordered delivery flow.

**Why this needs to change.** Nothing models *how the course unfolds* — which parts are live
chat vs material-backed, in what order, and what to do at each step. The trial filled the gap with
a non-conventional `material/README.md`. The concept-map says *what to learn*, the exposition-plan
*how to present*; the lesson-plan is the missing *what-to-do, in order*.

**Direction.** Concrete Zod (lightweight, closed enums where a choice must be honest):

```typescript
// src/schemas/lesson-plan.ts
const SegmentMode = z.enum(["interactive", "material"]); // live chat vs uses a material card
const SegmentStatus = z.enum(["planned", "ready"]);      // a material segment: outlined vs its card exists
const Segment = z.object({
  do: z.string(),                                  // the activity (terse — the WHY lives in the exposition-plan)
  mode: SegmentMode,                               // required — forces the live-vs-material call
  status: SegmentStatus.optional(),               // material segment: 'ready' (card exists) or 'planned' (deferred)
  concepts: z.array(z.string()).optional(),        // concept-map node id(s) this advances (lint-checked)
  material: z.object({ ref: z.string() }).optional(), // material segment → the card it uses (ref)
  note: z.string().optional(),                     // e.g. interactive framing even on a material segment
});
const lessonPlanFields = {
  segments: z.array(Segment).optional(),
  body: body(z.string()),                          // framing / rationale; living
};
```

`mode` is a required closed enum (the segment commits to live-vs-material), but a `material` segment
may still carry an interactive `note`, so "both" is expressible without a third mode.

`status` makes deferral **visible** (Codex #1): a `material` segment either has a `material` ref
(`ready`) or is marked `planned` (its card is outlined, not built yet). The box-aware lint warns on a
`material` segment that is *neither* — so "incomplete material" is never silent. "Complete build" is
therefore *not* "lesson-plan exists + no README"; it's "every material segment is `ready` or
explicitly `planned`."

The lesson-plan carries **no** course/concept-map back-ref. It's co-located with the concept-map in
the course attach scope, so the lint finds the concept-map as the **sibling `*.concept-map.card`** —
avoiding the optional back-ref that silently no-ops when absent (Codex #2: `lint-progress-nodes.ts:39`
returns `[]` on a missing `course` ref). `concepts` are concept-map node ids checked there. No
`validate` hook on the schema; Zod + the box-aware lint cover it.

**Card-rule (`instructions`).** What it conveys: the lesson-plan is the *ordered flow*, **distinct
from the exposition-plan** — the exposition-plan decides *why* an approach is used (the rated
approaches + rationale); the lesson-plan just *sequences* it (what to do, in order). The one real
per-segment choice is **`interactive` vs `material`**, with guidance: pick `interactive` when the
learning is in the back-and-forth (eliciting the learner's model, predict-and-explain, dialog); pick
`material` when a pre-made artifact carries it better than live talk (a figure to manipulate, a
written recap to re-read). Most early-course segments are interactive — author a material card only
where it earns it; the rest stay `planned`. `do` is terse (it's the activity, not the rationale —
that lives in the exposition-plan). Keep it sparse and fit-to-the-course; neutral pronouns.
Auto-published to `.claude/rules/card-lesson-plan.md` by `generateRules`.

**Vocabulary lock-ins:** type name `lesson-plan`; segment fields `do` / `mode`
(`interactive` | `material`) / `status` (`planned` | `ready`) / `concepts` / `material` / `note`; the
course's `lesson-plan` component ref. The lesson-plan↔concept-map link is **sibling-by-convention**,
not a ref.

**First implementation chunk.** `src/schemas/lesson-plan.ts` (schema + instructions + template) +
registry entry + `templates-courseware.ts` entry + the `"lesson-plan"` field on `course.ts` + a
`schemas.doctest.md` section (type, a valid plan parses, a segment missing `mode` fails, the
template parses). No open questions inside this chunk.

### Generalize the cross-card node-id lint

**What.** Make the progress→concept-map node-id check reusable so the lesson-plan's
`segments[].concepts` get the same integrity check.

**Why this needs to change.** A `segments[].concepts` id that doesn't exist in the course's
concept-map silently mis-links the flow to the map — the exact rot `lint-progress-nodes.ts` was
written to prevent for progress. Rebuilding it per-type duplicates the course→map→node-id walk.

**Direction.** Codex #3 is right that this is more than an `extractNodes` swap: the two types resolve
the concept-map *differently* and need *locatable* warnings. Factor a shared
`checkNodeRefs({ nodeIds, refs })` where `refs` is `Array<{ id, path }>` (path like
`segments[2].concepts[0]` / `entries[3].node`, so warnings are locatable — Codex #3), plus two
per-type adapters:
- **progress** — resolve the concept-map via its `course` ref (existing `lint-progress-nodes.ts:41-51`,
  unchanged); extract `entries[].node` with paths.
- **lesson-plan** — resolve the concept-map as the **sibling `*.concept-map.card`** in the card's own
  directory (co-located in the course attach; no ref to be silently absent — Codex #2); extract
  `segments[].concepts[]` with paths.

`card-lint.ts:171` keeps `if (type === "progress")` and gains `if (type === "lesson-plan")`, each
calling its adapter; both warning-level. The lesson-plan branch **also** emits the **deferral warning**
(Codex #1): a `material` segment with no `material.ref` and no `status: planned` → warning
`segments[N]: material segment with no material card; mark it 'planned' or add the card`. (This is
self-contained on the segment's fields, but lives in `card-lint` because it's a *warning*, not a
`validate`-hook error.)

**First implementation chunk.** Extract `checkNodeRefs` + the progress adapter, port progress onto it
(its doctest in `test/core/card-lint.doctest.md:477` must stay green — the regression anchor), then
add the lesson-plan adapter + the deferral warning + doctest cases (a bad segment node id → warning
naming the path; a material segment neither `ready` nor `planned` → warning; a valid plan → silent).

### Skill + material-convention fix + regenerate + fix the example

**What.** Teach `build-course` to produce a lesson-plan and treat material as cards; regenerate the
box's generated files; fix the committed Acids_Bases example.

**Why this needs to change.** The skill is what made the agent improvise a README; the card-rules
must ship to boxes; and the example in the main box currently shows the wrong convention.

**Direction.**
- **Build order — lesson-plan and material come last, after the other cards, as a draft→author→revise
  loop (not one pass).** The concept-map (structure) and exposition-plan (rules) settle *first*;
  progress *informs* the plan when there's a real learner but is **not required** — a `generic`
  course has no probe/progress, and the lesson-plan must still build (Codex #5). Then the tail step:
  (1) **draft the lesson-plan** (the segment sequence, each `interactive` or `material`), (2) **author
  only the material cards a segment actually references** and that earn being pre-made now (e.g. the
  one reused proton-transfer figure), (3) **revise the lesson-plan** so those segments are `ready`
  with real refs and the rest are explicitly `planned`. The three-step loop — not "build flow and
  material together in one pass" — is what keeps half-built material from hiding (Codex #5).
- **Incomplete is the expected end state, but it must be VISIBLE, not silent (Codex #1).** A build
  does **not** fully author the material; most segments stay `interactive` or `material`+`planned`,
  authored later during teaching. That's a *complete* build — but every deferred material segment is
  marked `status: planned` (the lint warns otherwise), so "outlined, not yet built" is a stated fact,
  not a gap that reads as done. The skill must say this so the agent neither (a) dumps a wall of
  half-baked material to "finish," nor (b) leaves material segments silently ref-less.
- Material is `doc`/`figure` cards in `material/`, **never a `README.md`**; the lesson-plan references
  them. The card-rule draws the line: the **exposition-plan** decides *why* an approach is used; the
  **lesson-plan** sequences it (interactive vs material) — so the agent doesn't conflate them or push
  rationale into the lesson-plan's `do`.
- Regenerate: after the schema/skill edits, `cb init <box>` re-runs `generateRules` (new
  `card-lesson-plan.md`) and `generateSkills` (updated `build-course`).
- Fix the example: in the **main box** (`~/src/boxes/test1/store/courses/Acids_Bases.*`), replace
  `material/README.md` with a real `lesson-plan` card (+ the one reused proton-transfer `figure`
  card the exposition-plan named, as a `doc`/`figure` material card), wire the course's
  `lesson-plan` ref, and re-commit that box.

**First implementation chunk.** The skill edits + `cb init` of the worktree box, verified by a
re-run build producing a lesson-plan and no README.

## Subplans

None. The node-id-lint generalization is small enough to do inline (one helper extraction); it does
not have its own vocabulary/research to settle.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Segment `mode` missing/invalid | Will add (parse doctest) | Yes — required closed enum, parse error | Clear (parse error) |
| `segments[].concepts` id not in the concept-map | Will add (card-lint doctest) | **Yes — box-aware lint via the sibling concept-map** | Clear (warning naming the path, e.g. `segments[2].concepts[0]`) |
| `material.ref` → missing/renamed card | Existing ref-walk doctests | Yes — generic broken-ref warning | Clear (warning) |
| **`material` segment, no `ref`, not `planned`** | Will add (card-lint doctest) | **Yes — deferral warning (Codex #1)** | **Clear (warning: mark `planned` or add the card)** |
| Agent still writes a `material/README.md` | No (prose) | Partial — skill + card-rule say "cards, not README" | Visible-not-lint-flagged (stray non-card file; guidance-mitigated) |
| Sibling `*.concept-map.card` absent (nothing to check against) | n/a | Yes — node check no-ops; the course's missing `concept-map` ref warns via the generic walk | Clear (the missing component warns at the course) |
| Half-built lesson-plan (no segments) | Will add (parse doctest) | Yes — all optional, lenient parse | Clear (loads) |

> **Critical gap:** none. The previously-silent risk — a `material` segment naming no card — is now a
> **visible lint warning** unless the segment is explicitly `status: planned` (Codex #1), so "outlined,
> not built yet" is stated rather than hidden. The one residual soft spot is a stray
> `material/README.md`: a non-card file the lint doesn't see, mitigated by the skill + card-rule (and
> plain in the dir listing). Accepted as a documented risk rather than adding a "no non-card files in
> `material/`" lint.

## Agent-flow / user-flow edge cases

- **Wrong field** — agent puts material content in the lesson-plan instead of a `doc` card, or tags a
  live-dialog segment `material`. **ADDRESSED** — card-rule draws the exposition-plan-vs-lesson-plan
  and interactive-vs-material lines explicitly; `mode` is a forced enum.
- **Stale ref** — a `material.ref` to a card that's moved/renamed. **ADDRESSED** — generic ref
  warning. A `concepts` id stale after the map changes → the generalized node-id lint warns.
- **Two agents on one lesson-plan** — last-write parse-mutate-reserialize, same as every card.
  **DEFERRED** (no new surface).
- **Hand-edit drift** — bad sub-key → unknown-key stripped + warned (lenient parse); a hand-broken
  `concepts` id → node-id lint warns.
- **Fabricated value** — agent invents a segment/material that isn't real. **GAP (by design)** — the
  skill's sparse/fit framing makes padding the low-value path, but it isn't enforced; the courseware
  family accepts this limit (same as the others).
- **Validation error UX** — the node-id lint phrases issues with the offending id (port the progress
  message). **ADDRESSED.**
- **Partial migration** — the existing Acids_Bases course predates the lesson-plan; it has a
  `README.md` and no `lesson-plan` ref. **ADDRESSED** — the example-fix chunk replaces it; other
  pre-existing courses (none yet) would simply lack a lesson-plan until rebuilt (optional field).

## NOT in scope

- **The Phase-2 tutoring runner.** The lesson-plan is the *plan*; actually conducting the interactive
  segments (running the dialog, retrieving answer keys, updating progress turn-by-turn) is the
  runner — later. Rationale: keep the line clear; the plan is authored once, the runner executes
  repeatedly.
- **A new `material` card type.** Material is existing `doc`/`figure` cards. Rationale: no new schema
  is needed; "don't add features beyond what the task requires."
- **A lesson-plan frontend renderer.** Renders as the default frontmatter-card view for now; the
  concept-map renderer is the precedent when one's wanted. Rationale: the content fix is the win; a
  bespoke timeline view earns its own design later.
- **A `mode` beyond interactive/material** (e.g. "assessment", "review"). Rationale: two modes cover
  the stated need; a `note` carries nuance. Add a mode only when a real third kind appears.
- **Compiling the lesson-plan to a path-loaded rule** (as the exposition-plan's `rules` are). The
  lesson-plan is a reference the agent reads when planning/teaching, not a standing ruleset.
  Rationale: it's a sequence, not rules; no auto-load needed.

## Resolved by the Codex pass (no longer open)

- **Node-id lint: `course` back-ref vs sibling `concept-map`? → sibling (Codex #2/#3).** A `course`
  back-ref would be a *second* edge to keep in sync with the manifest's own component refs, and the
  progress lint's "no `course` ref → silent no-op" (`lint-progress-nodes.ts:39`) showed how a missing
  back-ref silently disables the check. The lesson-plan lives in the course's attach scope alongside
  `*.concept-map.card`, so the lint resolves the map by **sibling glob**, no back-ref to drift. The
  generalized helper `checkNodeRefs({ nodeIds, refs })` takes the resolved node-id set either way, so
  progress (via its existing `course` ref) and lesson-plan (via sibling) share one core; see the lint
  track's Direction.
- **Enforce a `material` segment has a ref? → yes, as a `status`-gated warning (Codex #1).** Not a hard
  block (a segment can be drafted before its card exists), but no longer silent: a `material` segment
  with no `ref` warns *unless* it's explicitly `status: planned`. That makes "deferred" a stated fact
  rather than an invisible gap — see the schema track's `status` field and the Failure-modes table.

## Open design questions

- **Author the reused figure now, or only outline it?** *Lean:* author the one genuinely-reused
  material card (the proton-transfer `figure`) so the example is real, outline the rest in the
  lesson-plan; full material authoring is the teaching phase.
- **Fix the example by hand vs regenerate the whole course.** *Lean:* regenerate — it exercises the
  new skill end-to-end and yields a representative example, which hand-patching wouldn't.

## Knowledge audits

New agent-facing concepts → at least one `knows_directly` audit each in `knowledge-audits.yaml`
(tag `courseware`):

- **lesson-plan exists + what it's for** — can the agent state that the ordered delivery flow lives
  in a `lesson-plan` card (segments tagged interactive vs material), distinct from the exposition-plan?
- **material convention** — can it recall that material is `doc`/`figure` cards in `material/`, **not**
  a `README.md`?
- **exposition-plan vs lesson-plan** — the one confusion worth an audit: which holds the *rules*
  (exposition) vs the *ordered what-to-do* (lesson-plan)?

Land **run**: `pnpm knowledge-audit run --box <abs-path> --filter courseware` (the new entries),
status recorded, before the plan completes.

## Implementation order

1. **`lesson-plan` schema** + course `lesson-plan` field + registry + template + schema doctest.
2. **Generalize the node-id lint** — extract `checkNodeRefs({ nodeIds, refs })`, port the progress
   adapter (resolves the map via its `course` ref) onto it, add the lesson-plan adapter (resolves the
   map via the sibling `*.concept-map.card`) + the `material`/`status` deferral warning + doctest.
   Depends on (1) for the field names.
3. **Skill + material-convention** edits; `cb init` the worktree box; re-run a build to verify a
   lesson-plan + no README. Depends on (1).
4. **Knowledge audits** — write + run + record. Depends on (1)-(3) being in the box.
5. **Fix the example** in the main box (regenerate Acids_Bases or hand-author the lesson-plan +
   reused figure; replace the README), re-commit that box. Depends on (1)-(3).

Each is a commit (or few) on the worktree branch; the plan completes when all land, ships on the
boxholder's signal.

## Rollout shape

- **Tests** (per `docs/testing.md`, on substantial codepaths): the `lesson-plan` parse doctest
  (valid plan; segment missing `mode` fails; template parses); the generalized node-id lint doctest
  (a `lesson-plan` segment concept-id not in the sibling map → warning; a valid one → silent; **a
  `material` segment with no `ref` and not `status: planned` → deferral warning; the same with
  `status: planned` → silent**) **plus** the ported progress lint doctest staying green (the
  regression anchor for the extraction). No test for the skill prose — the knowledge audits are its
  check.
- **Knowledge-audit entries** — the three above land run.
- **Migration** — net-new card type + one new optional course field; no existing data shape changes.
  The only "migration" is the Acids_Bases example fix (chunk 5), done by the agent. `cb init`
  regenerates rules/skill idempotently.

## Relationship to the rest of courseware

This closes the Phase-1 gap the trial exposed (no delivery-flow artifact, non-conventional material)
without reaching into Phase 2: the lesson-plan is the authored *plan* the future tutoring runner will
*execute*. It sits beside `concept-map` (structure), `exposition-plan` (presentation rules), and
`progress` (learner state) as the fourth thing a course build produces, and it's what finally gives
`material/` a reason to hold real cards.

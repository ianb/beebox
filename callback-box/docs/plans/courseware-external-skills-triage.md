# Courseware prior art — triaging dmccreary/claude-skills

A review-planning doc, not a feature plan. The boxholder pointed at
`~/src/claude-skills` (Dan McCreary's "intelligent textbook" toolkit,
`github.com/dmccreary/claude-skills`, 26 skills) as likely prior art for our
courseware work — especially **knowledge graphs** and **figures / microsims**.

This triages all 26: most have no applicability and are listed once with a
reason; the ~13 worth talking through are grouped by theme, each with the
specific transferable idea, what it touches in our system, and the question to
settle when we discuss it. **Nothing here is decided** — it's the agenda for
that discussion.

Their system is MkDocs-Material textbooks at *whole-course* scale (200-concept
DAGs, 6–20 chapters, dozens of microsims). Ours is *module* scale (concept-map
~8 nodes, fit-to-the-learner, cycles allowed, evidence over completeness). So
the recurring move is **steal the method, drop the MkDocs/iframe stack and the
whole-course-completeness assumptions.**

## Decisions from the talk-through (2026-06-25)

Resolved with the boxholder, and the agreed pieces are **implemented**
(commit `70bbe1e1`):

- **Graph *construction* method → adopted.** The construction rules (entity
  names not questions, no orphans, avoid degenerate chains, real-relation edges,
  indegree = importance, granularity) are now in the concept-map card-rule and
  the build-course skill, plus an **orphan-node lint** (warning). The human
  review checkpoint became an **agent self-review** step — the learner co-creates
  the course and can't validate the graph, so the rules double as the agent's
  checklist.
- **Graph *visualization* → out.** Not a goal; viz is human-debugging only.
  Dropped the vis-network / 4th-runtime question entirely.
- **Bloom → used more fully, as instruction.** The six `depth` labels are defined
  in the concept-map rule; the (kind, depth) pair now steers approach choice in
  the exposition-plan. No schema/mechanism change.
- **Source-verification → adopted (light).** Claim-classification
  (verified / directional / qualitative / unsupported) + "never fabricate to fill
  a gap" folded into the skill's *Teaching well*.
- **Figure QA → adopted, bound to generation.** A render/clip check is now part
  of authoring a figure (not a separate audit pass). No 3-cycle Vision loop.
- **Figure examples → shipped** as `figure-examples.md` beside the build-course
  skill (loaded on demand), incl. a categorization-sort practice pattern.
- **Concept-map second lint (a) → done** (orphan node). **Lesson-plan
  prerequisite-order lint (b) → skipped** (too rigid for a dialog-first flow).
- **Quiz / structured assessment → out.** Live chat beats a quiz; progress stays
  evidence-from-dialog. (Misconception-aware *distractor* thinking already lives
  on concept nodes.)
- **Text-to-image → parked.** Revisit later; the Gemini path (`gen-image.ts`)
  already exists, so the strongest case (annotated-illustration backgrounds) is
  cheap to try when a real need appears.

The sections below are the original triage, kept as the record of what was
weighed.

## Skip — no applicability (triaged from the skill description)

| Skill | Why skip |
|---|---|
| `book-installer` | Installs MkDocs-Material templates + nav. Pure infra for their stack. |
| `init-textbook` | Scaffolds an MkDocs project (mkdocs.yml, docs/ tree). Their stack. |
| `docx-to-web-publisher` | `.docx` → Next.js React pages. Unrelated publishing path. |
| `readme-generator` | GitHub README with badges/metrics. Not courseware. |
| `register-book-analytics` | Wires Google Analytics 4 into MkDocs. Irrelevant. |
| `linkedin-announcement-generator` | Social post for a textbook milestone. Irrelevant. |
| `press-release-generator` | AP-style press release. Irrelevant. |
| `faq-generator` | Generates an FAQ artifact from content. Low-value content type for us. |
| `text-to-speech` | ElevenLabs TTS wrapper. We already have audio paths; not courseware-core. |
| `chapter-image-enhancer` | Sources Wikimedia/gov-archive photos + attribution. *Faint* overlap with our cite-sources stance, but it's image-attribution plumbing — skip. |
| `story-generator` | Illustrated graphic-novel narratives of scientists. A niche *exposition* modality at most; revisit only if "historical narrative" ever becomes a wanted approach. |
| `textbook-to-presentation-generator` | Generates a pptx lecture (pptxgenjs). Slides are out of scope; the "4-act storytelling" structure is a minor exposition note, not worth a build. |

Two of these (`chapter-image-enhancer`, `story-generator`, and arguably
`textbook-to-presentation-generator`) carry a *faint* idea; I've noted it inline
rather than promoting them to the review set. Say if you want any pulled up.

## Review — grouped by theme

### A. Knowledge graph & course structure

**`learning-graph-generator`** — *the flagship of their kit.* Generates ~200
concepts via a 13-step pipeline and validates the graph with `analyze-graph.py`:
cycle detection, self-dependency, **indegree ranking** (which concepts are
prerequisites for the most others → foundational importance), **max chain
depth** (prerequisite burden), foundational/terminal-node counts, disconnected-
subgraph detection.
- **Steal:** the *graph-quality checks* as a concept-map **shape lint** — orphan
  nodes, dangling edge targets, indegree/centrality, chain depth. We already
  have a node-id lint; this is the next tier (is the graph *well-formed and
  well-shaped*, not just *referentially intact*).
- **Tension:** they enforce a strict DAG (no cycles); we deliberately *allow*
  cycles (spirals). So adapt the checks to *report* cycles as info, not flag
  them as errors.
- **Touches:** `concept-map` (lint), `course` (Bloom-outcome framing).
- **Discuss:** Which shape-checks are worth a lint at our scale? At ~8 nodes,
  indegree/chain-depth may be overkill — but "orphan node" and "edge to nowhere"
  are cheap wins.

**`book-chapter-generator`** — sequences chapters from the graph by topological
sort + balanced size, then **validates every concept's prerequisites appear in
an equal-or-earlier chapter** (a hard Python check, zero violations allowed),
and handles terminal nodes (nothing depends on them) as flexible/enrichment.
- **Steal:** **topological prerequisite validation for the `lesson-plan`** —
  warn when a segment teaches a concept whose `prerequisite` edges haven't been
  covered by an earlier segment. This is the natural next lesson-plan lint after
  the node-id check we just shipped. Plus auto-generated "this segment builds
  on…" cross-references from the concept-map edges.
- **Tension:** cycles again — a spiral pair has no clean topological order;
  the check must tolerate `complements` cycles.
- **Touches:** `lesson-plan` (ordering lint), `concept-map` (edges).
- **Discuss:** Worth a lesson-plan ordering lint, or too rigid for a dialog-
  first flow where the agent reorders on the fly?

**`course-description-analyzer`** — scores a course description out of 100 against
a rubric: title, audience, prerequisites, topics, **"topics NOT covered,"** and
**3+ outcomes at each of the six Bloom levels**; gates graph generation on a
threshold.
- **Steal:** the **"topics NOT covered" / explicit out-of-scope** field for the
  `course` card (we value fit-not-completeness; naming the boundary is on-brand),
  and the idea of Bloom-spread in `success-criteria`.
- **Tension:** a 100-point gate is heavier than our casual, Piagetian,
  per-learner `success-criteria` — we'd want the *discipline* (span depths, name
  the boundary), not a numeric gate.
- **Touches:** `course`.
- **Discuss:** Add an out-of-scope field to `course`? Push success-criteria to
  span Bloom levels, or keep them casual?

**`glossary-generator`** — ISO 11179 definition discipline: every definition
scored on **Precision / Conciseness (20–50 words) / Distinctiveness /
Non-Circularity** (no "X is a kind of X"), plus concept-list hygiene (dedupe,
length) and cross-reference validation.
- **Steal:** ISO-11179-style **gloss quality** guidance for concept-map nodes
  (our `gloss` is a free one-liner today) — especially non-circularity and
  "define, don't restate the name." Cheap to fold into the concept-map card-rule.
- **Touches:** `concept-map` (`gloss`).
- **Discuss:** Card-rule guidance only, or an actual gloss lint? (Lean: rule
  guidance — a lint for prose quality is fuzzy.)

### B. Figures & microsims

**`microsim-generator`** — routes a figure request to one of ~8 libraries
(p5/Chart.js/Plotly/Mermaid/vis-network/vis-timeline/Leaflet/Venn.js) via a
0–100 scoring rubric, and maps **Bloom level → interaction pattern** (Understand
→ step-through, Apply → sliders, Analyze → explorer). Also: a `CANVAS_HEIGHT`
single-source-of-truth comment that drives iframe-height sync.
- **Steal:** (1) the **Bloom→interaction mapping** — a real input to the
  `exposition-plan`'s modality choice ("a figure claiming *Understand* shouldn't
  be a passive animation"). (2) A lighter **figure-type routing rubric** across
  our *three* runtimes. (3) A `CANVAS_HEIGHT`-style height declaration in the
  figure card (we have `width`/`height` frontmatter already — close).
- **Tension:** their routing assumes 8 libraries; ours is p5/three/d3. The
  *method* transfers; their library set doesn't (see vis-network below).
- **Touches:** `figure` schema/metadata, `exposition-plan` (modality).
- **Discuss:** Is a routing rubric worth it at 3 runtimes, or is the real win
  the Bloom→interaction guidance in the exposition-plan?

**`microsim-utils`** — figure QA tooling: a **Playwright control-visibility
test** (load at declared height, assert no button/slider is clipped), a
**postMessage auto-resize protocol** (sim posts its measured height, parent
fits), **Claude-Vision layout review** against a visual checklist (clipped
labels, overlap, contrast, draw-order), and headless-Chrome screenshot capture.
- **Steal:** We already screenshot figures (I did it twice this session,
  by hand). This formalizes it: a **figure render-check** (controls visible,
  no clipping) and an optional **Vision layout review** in the figure pipeline.
- **Touches:** figure render-verification tooling.
- **Discuss:** How much to build now — a one-shot "does it render + are controls
  visible" check is high-value; the full 3-cycle Vision review is heavier.

**`concept-classifier`** — a p5.js figure type: read a scenario, sort it into one
of N categories, with hints/explanations/score; content in `data.json`, logic in
`.js`. Targets Bloom **Apply**. Maps perfectly onto our `kind: concept` nodes
(recognize instances → varied examples + non-examples).
- **Steal:** a **categorization-practice figure pattern** — a reusable p5
  template, data-driven, for any "recognize the type" concept.
- **Tension (mild):** it's quiz-shaped (right/wrong + score). Fits *practice*,
  but keep it formative — feeds probing, not a `progress` score (see the quiz
  tension in C).
- **Touches:** `figure` (p5), `exposition-plan` (modality for `concept` nodes).
- **Discuss:** Worth shipping one or two canonical figure *templates* (this +
  the annotated-illustration below) the build-course skill can point at?

**`interactive-infographic-overlay`** — annotated-illustration figure: a
background image + numbered callout markers (or rectangular zones) with three
modes — **explore / quiz / edit** (`?edit=true` drags markers to calibrate, copy
JSON back). Percentage-based marker coords. Custom SVG+JS, not p5/three/d3.
- **Steal:** the **annotated-illustration-with-modes** pattern (great for
  anatomy/labeled diagrams) and especially the **edit-mode calibration UX** (a
  non-coder drags labels into place) — a genuinely nice authoring affordance.
- **Tension:** needs a background image → wants **text-to-image generation** we
  don't currently integrate; and it's a new render path (SVG overlay) outside
  our three runtimes (could be done as a d3/SVG figure).
- **Touches:** `figure` (new pattern, likely d3/SVG), exposition-plan, a
  possible text-to-image dependency.
- **Discuss:** Is labeled-diagram annotation a figure type we want? If so, the
  text-to-image gap is a real prerequisite decision.

**`causal-loop-diagram-generator`** — systems-thinking CLDs (signed feedback
loops, archetypes like limits-to-growth) rendered with **vis-network**;
notable trick: renders many diagrams **inline in one shared JS context** to dodge
the browser 6-iframe limit.
- **Steal:** CLDs as a **figure type for systems/feedback topics**; and the
  inline-shared-context rendering trick if we ever embed many graph figures on
  one page.
- **Tension:** **needs vis-network — a 4th runtime.** This is the one item that
  forces a real infrastructure decision. *Interesting aside:* vis-network is also
  a candidate renderer for our own **concept-map** view (today React Flow +
  dagre), so a 4th "graph" runtime could pay off twice.
- **Touches:** figure runtimes (new), possibly the concept-map renderer.
- **Discuss:** Do we want a graph/network runtime at all? If yes, it unlocks
  CLDs *and* an alternative concept-map renderer.

### C. Pedagogy, verification & audit

**`verified-infographic-generator`** — *the strongest single alignment in the
whole kit.* "Separate facts from pixels": build a claim plan → **web-search ≥2
sources per claim** (peer-reviewed > gov > institutional; reject sourceless) →
**classify every claim** (VERIFIED / DIRECTIONAL / QUALITATIVE-ONLY / REJECTED) →
user approval → **lock** the verbatim text → render → **multimodal audit** that
re-reads the pixels for drift. Emits a `sources.md` sidecar audit trail.
- **Steal:** this is **our `{% source %}` discipline operationalized into a
  pipeline.** The claim-classification taxonomy and the "missing data is a
  first-class output, don't fabricate to balance" rule map straight onto our
  "evidence over assertion." The sidecar source file ≈ a per-artifact source
  manifest. Adapt the *verify → classify → lock → audit* loop for material
  authoring (answer keys, figures, recaps).
- **Touches:** `material`, the `{% source %}` convention, exposition-plan.
- **Discuss:** Fold a lightweight version of this loop into the build-course
  "author material" step? (Lean: yes — it's our stance made concrete.)

**`chapter-content-generator`** — generates chapter prose with a **"define before
display"** scaffolding rule (no term appears in a diagram/table before prose has
defined it) and Bloom-appropriate difficulty.
- **Steal:** the **define-before-display** rule reinforces our dialog-first,
  build-from-what-they-have stance — a clean line for the exposition rules.
- **Touches:** `exposition-plan`, `lesson-plan`, `material`.
- **Discuss:** Add "define before you show it" to the exposition card-rule?
  (Lean: yes, it's a one-liner and on-brand.) Note it *doesn't* do source
  citation — a gap we already cover.

**`diagram-reports-generator`** — scans all chapters and reports a coverage table
(per diagram: Bloom level, UI complexity, difficulty). A pure **audit loop**.
- **Steal:** the **coverage-audit pattern**, generalized to courseware: which
  concept-map nodes have no material? which `material` claims lack a
  `{% source %}`? which nodes have no misconceptions noted? This is a natural
  companion to our existing knowledge-audit machinery.
- **Touches:** `concept-map`, `material`, `progress`, the audit tooling.
- **Discuss:** Worth a `cb`-side "course coverage" report? Where would it live?

**`quiz-generator`** — generates 10 MC questions/chapter, **Bloom-distributed**,
with misconception-aware distractors. **Direct conflict with our stance:** we
rejected ABCD/standardized assessment as the basis of `progress`.
- **The tension, surfaced:** the *format* (MC quiz → score → progress) is exactly
  what the boxholder rejected. But the *methodology underneath* — Bloom
  distribution + **distractors built from common misconceptions** — is sound and
  already half-present in our concept-map `misconceptions`.
- **Possible repurpose:** misconception-aware question design as **formative
  probing** (open Piagetian prompts that surface a wrong model), not summative
  scoring. The distractor bank ≈ the misconceptions we already track.
- **Touches:** `progress` (the wrong way), `concept-map` (misconceptions, the
  right way).
- **Discuss:** Do we want *any* structured practice/assessment, strictly
  formative and evidence-feeding — or does even that drift toward what we
  rejected? This is the most values-laden item; worth a real conversation.

## The biggest recurring themes (what to actually take)

1. **Source-verification as a pipeline** (`verified-infographic`) — our single
   best steal; it's `{% source %}` turned into verify→classify→lock→audit.
2. **A second tier of graph linting** (`learning-graph` + `book-chapter`) —
   shape checks (orphans, dangling edges) and lesson-plan prerequisite-order
   checks, *adapted to allow our cycles.* Natural sequel to the node-id lint we
   just shipped.
3. **Bloom as an active input, not a decoration** — recurs in nearly every skill
   (course outcomes, content difficulty, figure interaction, quiz spread). We
   have `depth` on nodes but barely use it. Decide if it should drive the
   exposition-plan's modality choice and success-criteria spread.
4. **Figure QA + a couple of canonical figure templates** (`microsim-utils`,
   `concept-classifier`, `interactive-infographic-overlay`) — formalize the
   screenshot/render check; maybe ship 1–2 reusable figure patterns.
5. **The assessment values question** (`quiz-generator`) — the one real conflict;
   resolve how much formative structure we want.

## Decisions that need you (the talk-through agenda)

1. **A graph/network figure runtime (vis-network) — yes or no?** Unlocks causal-
   loop diagrams *and* a possible alternative concept-map renderer. The only item
   that adds a dependency.
2. **Text-to-image integration — in scope?** Gates the annotated-illustration
   figure type.
3. **How much figure-QA tooling to build now** — just a render/clip check, or the
   full Vision-review loop?
4. **The assessment line** — any structured (formative-only) practice, or keep
   everything in live dialog + evidence?
5. **How far to push Bloom** — light touch (keep `depth` optional) vs. an active
   driver of modality and success-criteria.
6. **Second-tier concept-map / lesson-plan lints** — which shape/order checks
   earn their place at module scale.

## NOT in scope of this doc

Implementation. This is the agenda; each "steal" that survives the talk-through
becomes its own small plan (most are card-rule edits or one lint; the runtime and
text-to-image questions are larger and would each need their own).

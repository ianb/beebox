# Documentation reorganization

**Status:** partially implemented 2026-07-04 — survey done; plans sweep,
research/ dir, corrections batch, CLAUDE.md slimming, and first
cb-guide-* skills shipped; design reconciliation and filename review in
flight; see Tracks.

This plan reorganizes the monorepo's developer-facing documentation (~252
tracked `.md` files, excluding `callback-box/test/` fixtures and box-agent
docs that ship into boxes). Goals: surface the most important docs first,
fix inaccuracies, move skill-shaped content into skills, keep low-value
history out of the way but findable, and slim CLAUDE.md files down to
always-relevant instructions.

The survey below was produced by six parallel audit passes (reference docs,
plans taxonomy, CLAUDE.md/instruction files, skills↔docs overlap, strays,
findability), each spot-checking claims against the code tree.

---

## Current state of the documentation (survey)

### Scale and shape

- **252** tracked dev-doc markdown files. **159** under `callback-box/docs/`,
  of which **99** are the plans taxonomy (`plans/` 52, `implemented-plans/`
  43, `unimplemented-plans/` 4) and **60** are the reference/operational area.
- **11 CLAUDE.md files** (root, per-project, per-module). A typical
  callback-box session loads ~255 lines of always-on instruction context
  (root 47 + callback-box 149 + `@`-imported CODE-STYLE.md 59).
- **12 project-authored skills** in `.claude/skills/` (plus vendored
  `skill-creator`), all current, none contradicting any doc.
- Strays: root `docs/` (3 review artifacts), `notes/vision/` (3),
  `gstack-review/` (13), colocated `callback-box/src/**` module docs (9),
  deploy/feedback/dev/browse/scratch READMEs.

### The plans taxonomy has drifted (the biggest single problem)

`docs/plans/` claims to hold active proposals; in reality **only ~5 of 52
files are genuinely active plans** (`input-widget.md`, `interface-as-cards.md`,
`pdf-intake-design.md`, `source-editor.md`, `prompt-surface-ia-review.md`,
plus the open remainders of `box-commentary-surface.md` / `chat-husks.md`):

- **35 of 52 files aren't plans at all** — the `openclaw-hermes/` (30) and
  `pai-review/` (5) subdirectories are competitive-research substrate written
  to inform planning. They were parked in `plans/` for lack of a research
  home; the README's taxonomy doesn't address subdirectories.
- **At least 5 plans are done-but-never-moved**: `boxes-as-packages-v2.md`
  (its own header says "Status: Implemented (2026-07-04)"),
  `courseware-phase1.md` ("built and on `main`"), `web-page-commentary.md`
  (header claims unmerged branch; commits are on main), `query-cards.md`
  (header says "PARKED, not planned" — belongs in `unimplemented-plans/`),
  and `user-story-audit-followups.md` (mostly done).
- **Worst drift case: `triage-design.md`** — still opens with "early notes,
  design in progress" while the triage pipeline is fully built
  (`src/core/triage.ts` etc.) and ~13 other docs cite this file as the
  reference architecture. An agent landing there cold would badly misjudge
  whether the pipeline exists.
- Root causes are known and self-documented: `plans/README.md`'s "Wiring
  (pending)" admits `/finish` doesn't auto-`git mv` shipped plans, and there
  is no enforced status-header convention (four different ad-hoc styles;
  some files have none).
- 4 more top-level files are triage/worklist/index docs, not unit-of-work
  proposals (`courseware-external-skills-triage.md`,
  `external-skills-harvest.md`, `openclaw-hermes-comparison.md`).
- `implemented-plans/` and `unimplemented-plans/` are **clean** — spot-checks
  found no misfiling; `unimplemented-plans/README.md`'s disposition table
  matches its contents exactly. Minor: three separate `remove-cardworks-*.md`
  files record one migration (consolidation candidate).

### Plan-shaped docs squatting in the reference area

Six files in `docs/` proper are proposals/backlogs, not references:
`cli-restructure.md` (verified unimplemented; says "delete this doc when
done"), `capture-pipeline-redesign.md` (no implementation evidence,
decay-prone OCR vendor pricing), `todo-security.md` (orphaned TODO list),
`architecture/outline.md` (75%-unwritten writing plan),
`state-management-comparison.md` (bake-off record, unclear adoption), and
`testing-gaps.md` — whose frozen 2026-03 stats ("53 doctest files"; actual:
224) are **the most actively misleading numbers in the docs tree**.
`ideas.md` (1,681 lines) is also a backlog but is well-linked and functions
deliberately.

### Reference docs: mostly sound, with specific rot

The recent accuracy pass (210fce4d) largely held: the operational core
(`box-layout.md`, `testing.md`, `migrations.md`, `adding-schemas.md`,
`server-operations.md`, `procedure-implementation.md`, `glossary.md`,
`stack-decisions.md`, the Google/Telegram setup runbooks, CSP docs) verified
current and load-bearing. Specific defects found:

1. `EXAMPLE_FILES.md` — **wholesale stale** (~90% retired XML format; even
   its "current" section shows removed `box/commands/`), yet still linked
   from CLAUDE.md's Guides table as "Card examples."
2. `connectors.md` — Google Calendar row says service-injection "Not yet
   wired"; `createGoogleCalendarConnector` supports it like the others.
3. `callback-clerk/CLAUDE.md` — three wrong claims: nonexistent
   `extract.content.ts` (actual: `commentary-capture.content.ts`), wrong
   extraction library (says Readability; actual: Defuddle + DOMPurify +
   Turndown), stale `src/platform/` file list.
4. Broken links: `testing.md:481` → renamed `agent-browser` skill (now
   `browse`); `prompt-audits.md` → nonexistent `tone-design.md`;
   `ideas.md` (~line 1198) → pre-monorepo `~/src/callback/gstack-review/...`
   paths; doc-graph's standing broken-refs list (5 entries).
5. `.claude/memory/MEMORY.md` "Key Locations" — wrong monorepo path
   (`~/src/callback/`), lists removed `cardworks`, missing two projects.
6. `plans/README.md` "Wiring (pending)" still lists the cb-plan write-path
   fix as pending; it landed 2026-06-04.
7. `cards-as-markdown.md` — 2,552 lines of resolved RFC with ~50
   load-bearing lines at the top; the body belongs in `implemented-plans/`.
8. Point-in-time reports calcified as top-level docs:
   `knowledge-audit-rerun-2026-07-03.md` (orphaned), `user-stories.md`
   (5,767 generated lines), `doc-graph.md` (build artifact among
   hand-authored docs) — a generated/report-vs-doc split question.
9. Nine tracked `src/dev/reports/*.md` files (2026-02/03) contradict current
   policy — `.gitignore` and `knowledge-audits.md` both say reports are
   ephemeral. Straight `git rm`.

### CLAUDE.md files carry reference-shaped weight

- **Root CLAUDE.md: ~20 of 47 lines (43%) are dev-router implementation
  detail** (spawn model, PID files, orphan sweep, HMR self-healing) needed
  only when debugging the router. Extract to a `docs/dev-router.md`-style
  reference; keep the URL convention, lifecycle commands, and behavioral
  rules. The `bin/browse` paragraph duplicates the `browse` skill.
- **callback-box/CLAUDE.md: ~20 of 149 lines** are move-out candidates — the
  card-validation-hooks mechanics (~12–15 lines) and deploy bundling
  internals (already covered by `deploy/README.md`). Its dev-server section
  near-duplicates root CLAUDE.md's.
- **Two dead artifacts, both self-marked for deletion**:
  `THINKING_CLAUDE.md` (92 lines, pre-monorepo "thinking machine" spec;
  doc-graph annotates it "might get deleted") and `CLAUDE-MD-REVIEW.md`
  (447 lines; first line says "Delete after the proposed changes are applied
  or rejected"; still holds a real backlog of unaddressed items worth
  extracting to `ideas.md` first).
- The rest of the instruction surface is healthy: CODE-STYLE.md is tight and
  correctly `@`-imported; FRONTEND.md is the model for load-on-demand
  reference; `.claude/rules/doctest.md` is correctly path-scoped;
  `feedback-review/CLAUDE.md` is accurate (arguably skill-shaped);
  personal-vibe-check's four docs check out.

### Skills layer is healthy; the doc↔skill seam has gaps

- The judgment-in-skill / mechanics-in-doc split works where it exists
  (cb-migration ↔ `migrations.md` is the model; cb-debug ↔ `testing.md`,
  cb-frontend ↔ FRONTEND.md likewise). No contradictions found anywhere.
- **Skill-promotion candidates**: `adding-api-endpoints.md` (tRPC-vs-REST
  decision + checklist — exactly cb-migration's shape) and
  `adding-schemas.md` (new-card-type trigger; today someone must already
  know the doc exists). Docs stay as the detailed reference layer.
- **`prompt-audits.md` and the `cb-prompt-review` skill cover the same
  ground without referencing each other** — the clearest
  overlap-without-cross-reference in the corpus.
- The "what the agent knows" topic is split three ways (taxonomy in
  `agent-knowledge.md`, harness mechanics in `knowledge-audits.md`, routing
  in cb-context) — not duplicated, but a reader assembles it from three
  surfaces. `agent-knowledge.md` also mixes timeless taxonomy with dated
  2026-02 run logs.
- Drift risk: cb-migration restates ~7 non-negotiables from `migrations.md`
  near-verbatim rather than pointing.

### Findability: measured but not enforced, and thin at the entry points

- `pnpm doc-graph` regenerates a current orphans/broken-links report
  (`docs/doc-graph.md`, 177 docs) — good measurement, **no remediation
  loop** (nothing blocks a commit or nags on an unlinked new doc). Blind
  spot: it excludes `.claude/`, so skill-only references look like orphans.
- **One-hop reachability from any CLAUDE.md or skill: 31 of 159 docs
  (~19%).** Cross-linking is sparse-to-absent: 83% of docs contain zero
  markdown links to siblings; backtick mentions dominate.
- **Six true orphans** (zero inbound references anywhere, skills included):
  `chat-schedules.md` (current and load-bearing — the worst case),
  `telegram-setup.md`, `todo-security.md`,
  `knowledge-audit-rerun-2026-07-03.md`, and the two `architecture/` intro
  chapters — which even their own sibling `architecture/CLAUDE.md` fails to
  link. `prompt-logging.md` is a near-orphan; `scheduler.md` and
  `health-checks.md` are load-bearing but missing from CLAUDE.md's Guides
  table.
- The `/dev/docs` browser lists every tracked `.md` indiscriminately —
  a safety net, not curation; it doesn't distinguish live reference docs
  from plan archives.
- A past commit-time link-validation effort exists
  (`implemented-plans/link-validation-fix.md`) but is itself orphaned and
  evidently not catching the current broken-link list — needs a
  liveness check.

### Audience confusion (dev docs vs box-agent docs)

Two flagged cases: `landmark-curation.md` is written as second-person
guidance to the acting box agent but lives only in the dev repo (box
`should_read` pointers at it were found broken in the 2026-07-03 audit
rerun) — either reframe as dev rationale or ship its substance into boxes.
`scheduled/csp-violation-review.md` is half dev reference, half the literal
prompt fed verbatim to a scheduled agent; that class (agent-executed runbook
hosted in dev docs) may deserve an explicit home.

### Overlap clusters

- **Two competing "what is this system" narratives**: the `architecture/`
  vignette series (01/02 + spirit/family/writing-style scaffolding) vs.
  `DESIGN.md`/`IMPLEMENTATION.md` — never cross-referenced. Decide canonical
  roles (onboarding narrative vs. engineering rationale) or link them.
- `design-vision.md` is a thinner, staler sibling of `DESIGN.md` — merge or
  retire.
- `webpage-card-and-commentary.md` (implemented) vs `web-page-commentary.md`
  (plans/) — sequential features whose names read as duplicates.
- `google-setup.md` / `gmail-setup.md` / `google-drive.md` / `connectors.md`
  is a clean three-tier split; only missing forward links from google-setup.

### Strays: mostly legitimate homes

- **Colocated `src/**/CLAUDE.md` module docs are a healthy, load-bearing
  pattern** (connectors, reactor, services, chat, dev) — verified against
  code, well-linked. Keep as the template for module-level docs.
- `gstack-review/` is a referenced, load-bearing archive (two notes directly
  underlie the codex and cb-plan skills). Root `docs/` reviews are cited
  from plans and root CLAUDE.md. Deploy/feedback/dev/browse/scratch READMEs
  all verified current.
- `notes/vision/` (3 files, Feb 2026): unlinked; `cloud-infrastructure.md`
  is factually superseded by the hub architecture. Archive or fold
  still-relevant bits into `ideas.md`.

### Patterns that work (build on these)

- Honest staleness banners + retrospectives: `DESIGN.md`,
  `IMPLEMENTATION.md`, `migrations.md`'s self-disclosed stale table, and the
  `activities-design.md` + `activities-retrospective.md` pair (the model for
  recording removed features). Caveat: a banner alone isn't enough when a
  prominent CLAUDE.md link still presents the file as authoritative
  (EXAMPLE_FILES.md).
- The Guides table in callback-box/CLAUDE.md as the load-on-demand index —
  the right destination for content moved out of CLAUDE.md prose.
- The skill(judgment) ↔ doc(mechanics) layering, where wired.
- doc-graph as self-healing measurement — needs an enforcement loop and a
  `.claude/` fix, not replacement.

---

## Direction (boxholder input, 2026-07-04)

Principles set by the boxholder after reviewing the survey; the design
sections below must trace to these.

- **Colocate module docs; leave a one-sentence pointer in the parent.**
  When documentation is clearly about one module/directory (e.g. the dev
  router), it goes in a CLAUDE.md in that directory. The parent CLAUDE.md
  keeps only a pointer: the agent must know the thing exists, where, and
  what it does — one sentence, dense, doesn't have to read well (the
  register of a thought, not prose). All detail lives at the destination.
- **Two kinds of skills: behavioral and instructional.** Existing `cb-*`
  skills are behavioral (they shape how the agent works). When there's a
  *motivation/explanation* not obviously tied to one implementation locus
  (e.g. testing patterns — distinct from the behavioral cb-debug), it can
  be an *instructional* skill: brief, pointing to docs for depth. Several
  small ones can collapse into a single pointer-skill if the skill count
  grows too much. Use a naming pattern that distinguishes the two kinds.
- **Document only the non-obvious.** If a convention matches a fresh
  agent's intuition, documenting it is waste. The valuable docs are where
  the codebase *contradicts* intuition. Divergences that look incidental
  (ended up unusual by accident, not intent) get raised as questions to
  the boxholder, not enshrined in docs.
- **Competitive/research material gets a dedicated directory**, with a
  CLAUDE.md describing how the boxholder likes such reviews made (derived
  from how the existing ones were made).
- **Pointers to docs may live in module source comments** — worth using
  where an agent lands in code first.
- **Long docs can become subdirectories of small files** when the
  filename index itself makes content easier to search and find — the
  directory listing acts as a table of contents, and a search hit lands
  in a focused file rather than deep inside a monolith. Judge per doc:
  split when the doc is a collection of separable topics (DESIGN.md's 24
  sections, ideas.md's backlog), not when it's one continuous argument.
- **Filenames are part of the doc surface — review them and rename
  freely.** A filename is what an agent sees in a directory listing, a
  grep hit, or an index before deciding to read; it should say what the
  doc is now, not what it was when created. The survey's mislabels
  (EXAMPLE_FILES.md promising current examples, `triage-design.md` for
  what is now the triage reference, `webpage-card-and-commentary.md` vs
  `web-page-commentary.md` near-collision) are naming bugs, not just
  filing bugs. Renames are cheap: doc-graph self-heals and inbound links
  get updated in the same commit.
- **Design docs require reconciliation, not just filing.** None of the
  design documents may be right: the boxholder's design preferences have
  been developing, so DESIGN.md / design-vision.md / the architecture
  series can't be merged mechanically — reconciliation against current
  preference is its own work item.
- **Calibrate to current models.** Documentation practice should be
  contemporary with recent models (Opus 4.x / Claude 5 era) — what's
  worth writing changes as models improve; older CLAUDE.md-era guidance
  may over-document. (External research pass commissioned.)

## Stated preferences this plan trades against

*(pending — next section to write; will include the Direction section
above, `callback-box/CLAUDE.md`, CODE-STYLE.md, and the doc-altitude
feedback principle)*

## What already exists

*(covered by the survey above; to be distilled with citations when the
design sections are written)*

## Prior art (external)

*(pending)*

## Tracks / scope

1. **Plans-taxonomy sweep + research/ home** — DONE (commit d4ab..→).
   5 shipped plans → implemented-plans/, 2 parked, triage-design promoted
   to reference, status-header convention in plans/README.md, top-level
   `research/` with its own CLAUDE.md. Remaining: wire `/finish` to
   auto-move shipped plans (still a plans/README TODO).
2. **Corrections + non-obvious-conventions batch** — DONE (86cc902a).
   38 items: all confirmed-wrong claims fixed; 13 undocumented
   conventions documented at colocated homes (new `src/hub/CLAUDE.md`,
   `docs/card-validation.md`); findability quick wins (Guides rows,
   orphan links, prompt-audits ↔ cb-prompt-review cross-refs).
3. **CLAUDE.md slimming** — DONE. Root 47→34 lines (mechanism →
   `bin/CLAUDE.md`); callback-box CLAUDE.md deduped/trimmed with
   pointers. Shared-router caution promoted to a stated rule.
4. **Instructional skills (`cb-guide-*`)** — STARTED. Naming decided:
   behavioral skills stay bare `cb-*`; explanatory/pointer skills are
   `cb-guide-*`. First three shipped: cb-guide-testing, cb-guide-api,
   cb-guide-schemas (each: motivation + decision rules, pointing to the
   reference doc for mechanics). Add more only when a real trigger gap
   shows up; collapse into one pointer-skill if the count grows heavy.
5. **Design reconciliation** — IN FLIGHT. Boxholder chose
   adjudication-first: a divergence list
   (`docs/plans/design-reconciliation.md`) where he rules per item;
   docs are rewritten to match rulings afterwards. Roles of DESIGN.md /
   IMPLEMENTATION.md / design-vision.md / architecture-series get
   settled there, including possible long-doc → subdirectory splits.
6. **Filename review** — IN FLIGHT. Proposal list being produced
   (rename freely once approved; doc-graph self-heals, links fixed in
   the same commit).
7. **Findability enforcement** — NOT STARTED. doc-graph measures but
   nothing enforces: candidate = a commit-time (or maintenance-cadence)
   check that a new doc has ≥1 inbound reference and no broken links;
   also fix doc-graph's `.claude/` blind spot so skill references count.
8. **Long-doc splits** — the design.md split executes under track 5;
   remaining item: move cards-as-markdown.md's resolved RFC body to
   implemented-plans/ keeping a short format reference. ideas.md is
   EXCLUDED by boxholder ruling (2026-07-04): it's a task tracker, a
   separate kind of thing from reference docs — leave it alone.

## Open design questions

- Unanswered from the gap analysis (docs-reorg.gap-analysis.md B6–B9):
  pin YAML `lineWidth: 0`? case-insensitive basename-collision lint?
  unify/cross-reference the boxes.json vs hub.json registration
  manifests? `@xstate/store` — still the plan or strike the
  stack-decisions entry?
- ~~Filename conventions~~ RULED (2026-07-04): kebab-case everywhere
  (lowercase the SCREAMING files; README/CLAUDE.md exempt); point-in-time
  artifacts live in `docs/reports/` with date-stamped names (generated
  indexes whose paths tooling hardcodes, like doc-graph.md, stay put);
  superseded docs ALWAYS get a `-superseded` filename suffix; "design"/
  "investigation" stems are stripped when a doc's role changes to
  current-state reference (decision-record narratives keep their names).
  Conventions to be recorded in a new `docs/README.md`.
- `chat-job.ts` schema `instructions` still describe XML message tags
  while `chat-thread.ts` writes YAML `kind:` entries — prompt-surface
  bug found during the batch; fix under cb-prompt-review discipline.
- Where does the reactor-resume class of finding go long-term: the
  gap-analysis produced one real bug (fixed, 62667243) — should future
  doc audits routinely include a "docs claim X, code does Y, which is
  right?" pass?

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A moved/renamed doc leaves a stale inbound link | doc-graph reports broken refs | manual re-run only | silent until doc-graph is next run |
| New doc lands with zero inbound links (orphan) | doc-graph orphan list | no enforcement (track 7) | silent |
| CLAUDE.md pointer says one sentence but the colocated doc drifts | no | banner convention only | silent |
| A cb-guide-* skill restates a doc and they drift apart | no | skills kept pointer-shaped by convention | silent |
| /finish ships a plan but doesn't move it to implemented-plans | no | README TODO; manual sweep | silent (this survey found 5 such) |

**Critical gap:** orphan/broken-link creation is silent between manual
doc-graph runs — track 7 is the fix; until it lands, `pnpm doc-graph`
belongs in the maintenance cadence (it is listed in docs/maintenance.md).

## NOT in scope

- Rewriting box-agent-facing documentation (agent guide, box CLAUDE.md
  templates, rules) — that's the cb-context/cb-prompt-review surface;
  this plan only touched it where dev docs were wrong about it.
- The 277-unused-exports knip backlog (recorded in ideas.md).
- Splitting `test/helpers/fake-agent.ts` to clear its pre-existing
  single-export lint errors (noted during the reactor fix).
- Automating design-doc freshness (e.g. doctest-enforced doc claims)
  beyond box-layout.md's existing doctest guard.

## Knowledge audits

This plan is dev-repo documentation; box agents never see these docs, so
no knowledge-audit entries land with it. The one agent-facing change
(chat-schedules/glossary wording about pseudo-XML) is covered by the
existing schedule-tag audits.

## Implementation order / rollout

Tracks 1–4 shipped as three commits on this worktree branch (plus the
reactor fix that fell out of the gap analysis). Remaining order: 5 and 6
land after boxholder rulings; 7 is independent and small; 8 last, gated
on 5. Ships by merging the worktree to main as usual.

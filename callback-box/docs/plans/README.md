# docs/plans/ — proposals and in-flight plans

Three different kinds of document used to be mixed in a flat `docs/`, all
wearing the same `.md` extension:

1. **Proposals / plans** — "here's what we intend to build," written before the
   work, full of open questions and trade-offs.
2. **Records of shipped work** — detailed plans of *past* work, kept for history.
3. **Reference documentation** — "here's how the system works," describing what
   *is*, kept current.

Mixing them confuses readers (and agents): a proposal reads as if it describes
reality, and a finished plan reads as if it's still open. This directory splits
them.

## The convention

- **`docs/plans/<topic>.md`** — active proposals and in-flight plans. A plan is
  a complete unit of work, designed end-to-end (see the `cb-plan` skill).
  Subplans: `<topic>.subplan.md`. Reviews: `<topic>.review.md`.
- **`docs/implemented-plans/<topic>.md`** — plans whose work has shipped. Moved
  here (not deleted) on merge, so the detailed reasoning behind past work stays
  findable without masquerading as current docs.
- **`docs/<anything-else>.md`** — reference documentation: how the system works
  *now*. Kept current. Not a graveyard for finished proposals.

Rule of thumb: if it says *"we should…/this plan adds…/open question:"* it's a
plan. If it says *"the system does X"* and that's true today, it's reference
docs. When a plan ships, either fold its durable "how it works" parts into
reference docs **and** move the plan to `implemented-plans/`, or just move it if
the reference material already lives elsewhere.

## Status-header convention

Every plan's first line (right under the title) must be a status line of the
form:

```
**Status:** <active | implemented YYYY-MM | partially implemented YYYY-MM | parked YYYY-MM> — <one short clause>
```

- **active** — in `docs/plans/`, not yet (fully) shipped.
- **implemented YYYY-MM** — shipped; the doc belongs in `implemented-plans/`.
- **partially implemented YYYY-MM** — some of it shipped, some didn't; stays in
  `docs/plans/` until the remainder lands or is dropped.
- **parked YYYY-MM** — shelved without shipping; the doc belongs in
  `unimplemented-plans/`.

This is what lets an agent tell, from the first line, whether a plan
describes the present or an intention — the drift that caused the 2026-07
doc reorg (stale "in progress"/"unmerged branch" headers on plans that had
actually shipped) is exactly what this convention prevents.

## Research and competitive corpora live elsewhere

Competitive/comparative research (OpenClaw, Hermes, Letta, PAI, gstack, and
similar) is **not** a plan and does not live here — it lives in the
monorepo-top-level `research/` directory (see `research/CLAUDE.md`). Findings
worth pursuing get cross-linked into `docs/ideas.md` or promoted to an actual
plan in this directory.

## Wiring (pending)

- **`finish`** should `git mv docs/plans/<topic>.md docs/implemented-plans/` as
  part of the merge close-out, so shipping a plan files it automatically.

## Migration (done)

The first backlog batch was migrated and all `docs/…` references rewritten:

- → `implemented-plans/`: `selection-commentary.md`, `markdoc-tags-plan.md`
  (+ `.review.md`, `.review-adapted-trial.md`), `markdoc-format-investigation.md`,
  `shared-frontend-backend-code.subplan.md`, `narration-mode-design.md`
  (feature shipped, despite the doc's stale "proposal" header — later
  found to be inaccurate; see 2026-07-04 below).
- → `plans/` (still open): `pdf-intake-design.md` (not yet implemented),
  `source-editor.md`. (`triage.md` later turned out to be fully built
  and was promoted to `docs/triage.md` as a reference doc — see the
  2026-07 doc reorg.)

**2026-07-04:** `implemented-plans/narration-mode-design.md` was moved back
to `plans/narration-mode.md` — the doc opens "Status: proposal, for
discussion" and was never actually implemented; its earlier placement in
`implemented-plans/` above was a misfiling, not a correction.

**Follow-ups:**
- Regenerate the doc graph (`pnpm doc-graph`) — it's generated and still shows
  the old paths; it self-heals on the next run.
- A few more plan-shaped docs remain in `docs/` and need a judgment call on
  reference-vs-proposal before moving: `activities-design.md`,
  `event-bus.md`, `photo-storage-investigation.md`. Left in place
  (some read more like vision/reference than active proposals — `design.md`,
  `design-vision.md`, `stack-decisions.md` are reference and stay).
  `design-card-views.md` has since moved to `unimplemented-plans/`
  (superseded by the shipped renderer registry, now
  `design-card-views-superseded.md`), `attach-implementation.md`
  to `implemented-plans/` (superseded by `docs/asset-manifests.md`, now
  `attach-directories-superseded.md`), and
  `capture-pipeline-redesign.md` to `unimplemented-plans/` (parked 2026-03).
